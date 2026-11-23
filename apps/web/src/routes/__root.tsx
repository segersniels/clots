import { createRootRoute, Outlet } from "@tanstack/react-router";

import { BotList } from "../components/BotList.tsx";

export const Route = createRootRoute({ component: Layout });

function Layout() {
  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[19rem_1fr]">
      <div className="hidden min-h-0 md:block">
        <BotList />
      </div>
      <main className="min-h-0 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
