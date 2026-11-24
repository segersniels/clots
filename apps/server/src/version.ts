import { version } from "../../../package.json" with { type: "json" };

/** The clots version from the root `package.json`. The compiled binary carries it. */
export const CLOTS_VERSION: string = version;
