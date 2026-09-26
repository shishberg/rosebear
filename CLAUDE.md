# Working in this repo

Keep project facts in the READMEs and docs, not here. This file covers where to look and how to work.

## Orienting yourself

- The repo holds several generations of the keyboard side by side. The top of the root `README.md` names the active design; the rest of that README covers the original board. Check it before assuming which version a question is about.
- Each version directory has its own README (`v3/README.md`, `v4/README.md`). Read the active one before answering design questions. Its build, parts and outputs tables say which code and docs are current.
- `v2*.md` and `v3-flex.md` at the root are design notes from earlier versions. Later versions build on some of their decisions, so they are still useful background, but a version's README wins where they conflict.
- Docs inside a version can disagree with each other or describe paused work. When they conflict, check the code or the generated output before trusting either doc.
- `output*/` directories are generated and gitignored. Never edit them by hand. They are still useful to read: for example, generated pinout and wiring files often answer hardware questions faster than the source does.
- Answer hardware questions (which controller, which pins are free, which parts) by searching the repo for part numbers, net names and GPIO numbers. Don't infer them from indirect evidence.
- `.claude/skills/` has project skills (such as board evaluation). `.claude/worktrees/` holds agent worktrees, not project source.

## Committing

- Always commit your work before finishing. Uncommitted or untracked work is easy to lose and hard for the next session to find.
- Run `git status` at the start and end of a task. Look for untracked directories as well as modified files, and ask about anything significant that isn't tracked.
- Keep commits to the task at hand. Leave unrelated changes you didn't make out of your commits, and mention them.
- Commit messages follow the existing style: a version prefix, such as `v4: ...`, then a short description.
