import type { Project } from "@clots/contracts";
import { Context, Effect, Layer, PubSub } from "effect";
import { SqlClient } from "effect/sql";

export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<Project>>;
    create(name: string, directory: string | null): Effect.Effect<Project>;
    rename(projectId: string, name: string): Effect.Effect<void>;
    /**
     * Deletes the project. Its bots move to no project. A bot that worked in the project directory
     * also forgets its session, because Claude Code stores a session under its directory.
     */
    remove(projectId: string): Effect.Effect<void>;
    /** Fires after each write, so that clients can read the list again. */
    readonly changes: PubSub.PubSub<void>;
  }
>()("clots/projects/ProjectRepository") {
  static readonly layer = Layer.effect(
    ProjectRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const changes = yield* PubSub.unbounded<void>();

      return ProjectRepository.of({
        changes,

        list: sql<Project>`SELECT id, name, directory FROM projects ORDER BY created_at`.pipe(
          Effect.orDie,
        ),

        create: (name, directory) => {
          const project: Project = { id: crypto.randomUUID(), name, directory };

          return sql`
            INSERT INTO projects (id, name, directory, created_at)
            VALUES (${project.id}, ${name}, ${directory}, ${Date.now()})
          `.pipe(
            Effect.orDie,
            Effect.andThen(PubSub.publish(changes, undefined)),
            Effect.as(project),
          );
        },

        rename: (projectId, name) =>
          sql`UPDATE projects SET name = ${name} WHERE id = ${projectId}`.pipe(
            Effect.orDie,
            Effect.andThen(PubSub.publish(changes, undefined)),
            Effect.asVoid,
          ),

        remove: (projectId) =>
          Effect.gen(function* () {
            yield* sql`
              UPDATE threads SET sdk_session_id = NULL
              WHERE bot_id IN (SELECT id FROM bots WHERE project_id = ${projectId})
                AND (SELECT directory FROM projects WHERE id = ${projectId}) IS NOT NULL
            `;
            yield* sql`UPDATE bots SET project_id = NULL WHERE project_id = ${projectId}`;
            yield* sql`DELETE FROM projects WHERE id = ${projectId}`;
          }).pipe(
            sql.withTransaction,
            Effect.orDie,
            Effect.andThen(PubSub.publish(changes, undefined)),
            Effect.asVoid,
          ),
      });
    }),
  );
}
