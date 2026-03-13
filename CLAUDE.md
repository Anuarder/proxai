# Proxai - Claude Code Rules

## Git

- **Never add Co-Authored-By lines** to commit messages

### Starting a new task

1. If on a feature branch with uncommitted changes — commit and push first
2. `git checkout main && git pull`
3. Create a new branch: `git checkout -b feature/<task-name>`

### Finishing a task

1. Commit changes
2. Push the branch: `git push -u origin <branch-name>`
3. Inform the user that the branch is ready (for PR, merge, etc.)
