// Spike 3: join the tailnet with tsnet, serve HTTPS on *.ts.net, and report the caller from WhoIs.
package main

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"

	"tailscale.com/tsnet"
)

func main() {
	server := &tsnet.Server{Hostname: "clots-spike", Dir: "./state"}
	defer server.Close()

	localClient, err := server.LocalClient()
	if err != nil {
		log.Fatal(err)
	}

	listener, err := server.Listen("tcp", ":443")
	if err != nil {
		log.Fatal(err)
	}

	tlsListener := tls.NewListener(listener, &tls.Config{GetCertificate: localClient.GetCertificate})
	log.Printf("spike: listening, cert domains: %v", server.CertDomains())

	log.Fatal(http.Serve(tlsListener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		who, err := localClient.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		log.Printf("spike: whois login=%s node=%s", who.UserProfile.LoginName, who.Node.ComputedName)
		fmt.Fprintf(w, "login=%s node=%s\n", who.UserProfile.LoginName, who.Node.ComputedName)
	})))
}
