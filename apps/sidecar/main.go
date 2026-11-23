// The clots sidecar joins the tailnet as its own node, serves HTTPS on <hostname>.<tailnet>.ts.net,
// and forwards admitted callers to the clots server on loopback.
package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/tsnet"
)

// identityHeader carries the caller's Tailscale login to the clots server. The sidecar removes any
// value that the caller sent, so the server can trust it.
const identityHeader = "Clots-User-Login"

const (
	admissionOwner      = "tailscale_owner"
	admissionIdentified = "tailscale_identified"
)

// status is the file that `clots up` and `clots status` read to learn what the operator must do.
type status struct {
	// State is "needs_login", "needs_https" or "ready".
	State   string `json:"state"`
	AuthURL string `json:"authUrl,omitempty"`
	URL     string `json:"url,omitempty"`
}

func main() {
	hostname := flag.String("hostname", "clots", "the name of the node on the tailnet")
	stateDir := flag.String("state-dir", "", "the directory for the Tailscale state and status.json")
	upstream := flag.String("upstream", "127.0.0.1:4587", "the address of the clots server")
	admission := flag.String("admission", admissionOwner, "who can connect: tailscale_owner or tailscale_identified")
	flag.Parse()

	if *stateDir == "" {
		log.Fatal("sidecar: --state-dir is required")
	}

	if *admission != admissionOwner && *admission != admissionIdentified {
		log.Fatalf("sidecar: unknown admission mode %q", *admission)
	}

	server := &tsnet.Server{Hostname: *hostname, Dir: *stateDir, Logf: func(string, ...any) {}}
	defer server.Close()

	client, err := server.LocalClient()
	if err != nil {
		log.Fatal(err)
	}

	go reportStatus(client, filepath.Join(*stateDir, "status.json"))

	listener, err := server.Listen("tcp", ":443")
	if err != nil {
		log.Fatal(err)
	}

	proxy := httputil.NewSingleHostReverseProxy(&url.URL{Scheme: "http", Host: *upstream})
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		login, admitted := admit(r.Context(), client, r.RemoteAddr, *admission)
		if !admitted {
			http.Error(w, "clots: this Tailscale user is not admitted", http.StatusForbidden)
			return
		}

		r.Header.Set(identityHeader, login)
		proxy.ServeHTTP(w, r)
	})

	tlsListener := tls.NewListener(listener, &tls.Config{GetCertificate: client.GetCertificate})
	log.Fatal(http.Serve(tlsListener, handler))
}

// admit reports the caller's login and whether the admission mode lets the caller in.
func admit(ctx context.Context, client *local.Client, remoteAddr string, admission string) (string, bool) {
	who, err := client.WhoIs(ctx, remoteAddr)

	// A tagged node has no user, so it never passes.
	if err != nil || who.UserProfile == nil || who.Node.IsTagged() {
		return "", false
	}

	if admission == admissionIdentified {
		return who.UserProfile.LoginName, true
	}

	self, err := client.StatusWithoutPeers(ctx)
	if err != nil || self.Self == nil {
		return "", false
	}

	// The owner is the user who logged this node in.
	return who.UserProfile.LoginName, who.UserProfile.ID == self.Self.UserID
}

// reportStatus writes status.json each time the state of the node changes.
func reportStatus(client *local.Client, path string) {
	var last status

	for ; ; time.Sleep(time.Second) {
		current, ok := readStatus(client)
		if !ok || current == last {
			continue
		}

		last = current
		encoded, _ := json.Marshal(current)

		// Write to a temporary file first, so a reader never sees a partial file.
		if err := os.WriteFile(path+".tmp", encoded, 0o600); err == nil {
			_ = os.Rename(path+".tmp", path)
		}
	}
}

func readStatus(client *local.Client) (status, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	node, err := client.StatusWithoutPeers(ctx)
	if err != nil {
		return status{}, false
	}

	if node.BackendState != "Running" {
		// The login link appears a moment after the node starts.
		return status{State: "needs_login", AuthURL: node.AuthURL}, true
	}

	// The tailnet admin must enable HTTPS certificates before the node gets a certificate domain.
	if len(node.CertDomains) == 0 {
		return status{State: "needs_https"}, true
	}

	return status{State: "ready", URL: "https://" + node.CertDomains[0]}, true
}
