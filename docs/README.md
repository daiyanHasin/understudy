# Understudy documentation

| Document | Read it when |
|---|---|
| [USER-GUIDE.md](USER-GUIDE.md) | you use Understudy (testers) |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | something doesn't work |
| [FILE-MAP.md](FILE-MAP.md) | you want to know which file does what |
| [ARCHITECTURE.md](ARCHITECTURE.md) | you want to know how the parts fit together |
| [DECISIONS.md](DECISIONS.md) | you wonder *why* it's built this way |
| [ROADMAP.md](ROADMAP.md) | you plan what's next (v3 = stable, then desktop app) |
| [TESTING.md](TESTING.md) | before a commit, before a release, and the v3 exit criteria |
| [RELEASING.md](RELEASING.md) | you publish a version |
| [THREAT-MODEL.md](THREAT-MODEL.md) | you add a route, a command, a download or a file path |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | you change how something looks |

Release notes are in [../CHANGELOG.md](../CHANGELOG.md).

**Golden rule:** run `npm run check` after every change. When you add, move or delete a file, update `FILE-MAP.md` in the same commit.
