import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { client } from "../client.ts";

export const Route = createFileRoute("/projects/new")({ component: NewProject });

function NewProject() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [directoryMissing, setDirectoryMissing] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await client.createProject(name.trim(), directory.trim() === "" ? null : directory.trim());
      await navigate({ to: "/" });
    } catch {
      // The server rejects a directory that does not exist on the host.
      setDirectoryMissing(true);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="window-drag flex h-13 shrink-0 items-center justify-center px-5">
        <h1 className="font-medium">{name.trim() || "New Project"}</h1>
      </header>

      <form onSubmit={create} className="mx-auto flex w-full max-w-sm flex-col px-4 pt-[9vh]">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="project-name">Name</FieldLabel>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
              placeholder="Mejl"
            />
          </Field>

          <Field data-invalid={directoryMissing}>
            <FieldLabel htmlFor="project-directory">Directory</FieldLabel>
            <Input
              id="project-directory"
              value={directory}
              onChange={(event) => {
                setDirectory(event.target.value);
                setDirectoryMissing(false);
              }}
              aria-invalid={directoryMissing}
              placeholder="~/code/mejl"
              className="font-mono"
            />
            <FieldDescription>Optional. A folder on the server. The bots of this project work in it.</FieldDescription>
            {directoryMissing && <FieldError>This directory does not exist on the server.</FieldError>}
          </Field>
        </FieldGroup>

        <Button type="submit" size="lg" disabled={name.trim() === ""} className="mt-7 self-center px-5">
          Create project
        </Button>
      </form>
    </div>
  );
}
