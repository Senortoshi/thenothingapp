import { spawnSync } from "node:child_process";

const message = process.argv.slice(2).join(" ").trim() || "chore: checkpoint";

const add = spawnSync("git", ["add", "-A"], { stdio: "inherit" });
if (add.status !== 0) process.exit(add.status ?? 1);

const commit = spawnSync("git", ["commit", "-m", message], { stdio: "inherit" });
if (commit.status !== 0) process.exit(commit.status ?? 1);
