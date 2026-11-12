"""Save all authored work and knowledge without copying dependency/build caches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile

SKIP_DIRS = {".git", "node_modules", "target", "dist", "__pycache__", ".tools", "graphify-out"}
EVIDENCE_EXT = {".md", ".json", ".txt", ".log", ".png", ".jpg", ".jpeg", ".svg", ".csv", ".tsv", ".html", ".pdf", ".patch", ".diff", ".ts", ".rs", ".mjs", ".py", ".ps1", ".toml", ".lock"}


def git(directory, *args, allow_failure=False):
    result = subprocess.run(["git", "-C", str(directory), *map(str, args)], capture_output=True)
    if result.returncode and not allow_failure:
        raise RuntimeError(result.stderr.decode("utf-8", "replace"))
    return result.stdout if not result.returncode else None


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def names(data):
    return [x.decode("utf-8") for x in data.split(b"\0") if x]


def ignored(name):
    p = Path(name)
    return any(x in SKIP_DIRS or x == "artifacts" for x in p.parts) or p.suffix.lower() in {".exe", ".pdb", ".dll", ".o", ".pyc"} or p.name in {".env", "auth.json"} or p.suffix.lower() in {".pem", ".key", ".pfx"}


def walk(directory):
    if not directory.exists():
        return
    for p in sorted(directory.iterdir()):
        if p.is_symlink() or (hasattr(p, "is_junction") and p.is_junction()):
            continue
        if p.is_dir():
            if p.name not in SKIP_DIRS:
                yield from walk(p)
        elif p.is_file():
            yield p


def save_zip(destination, entries):
    manifest = {}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for source, relative in sorted(entries, key=lambda x: x[1]):
            before = sha(source)
            z.write(source, relative)
            if sha(source) != before:
                raise RuntimeError("Source changed while archiving: " + str(source))
            manifest[relative] = before
    with zipfile.ZipFile(destination) as z:
        for name, expected in manifest.items():
            with z.open(name) as f:
                if hashlib.file_digest(f, "sha256").hexdigest() != expected:
                    raise RuntimeError("ZIP verification failed: " + name)
    return manifest


def create(root, build):
    root, build = root.resolve(), build.resolve()
    if not (build / "verification.txt").is_file():
        raise RuntimeError("The requested build has not been verified")
    package = build / "weiterarbeiten"
    package.mkdir()  # Never overwrite an existing handoff.
    (package / "INCOMPLETE").write_text("Do not use until RESTORE-VERIFIED.json exists", encoding="utf-8")
    (package / "git").mkdir()
    (package / "states").mkdir()
    (package / "reference").mkdir()
    groups = {}
    for candidate in sorted((root / "forks").iterdir()):
        if not candidate.is_dir():
            continue
        common = git(candidate, "rev-parse", "--path-format=absolute", "--git-common-dir", allow_failure=True)
        if common:
            groups.setdefault(common.decode().strip(), []).append(candidate)
    if not groups:
        raise RuntimeError("No development repositories discovered")
    manifest = {"formatVersion": 1, "repositories": [], "legacyArchives": [],
                "workspaceArchive": "workspace-knowledge.zip", "evidenceArchive": "reports-evidence.zip",
                "resourcesArchive": "private-resources.zip", "excluded": []}
    for i, (_, trees) in enumerate(groups.items()):
        representative = trees[0]
        repo = {"id": "kizamubeam" if i == 0 else "repo-" + str(i), "bundle": "git/repository-" + str(i) + ".bundle", "worktrees": [], "gitSettings": {}, "branchSettings": {}}
        for setting in ["core.autocrlf", "core.eol", "core.filemode", "core.ignorecase"]:
            value = git(representative, "config", "--get", setting, allow_failure=True)
            if value:
                repo["gitSettings"][setting] = value.decode().strip()
        tracking = git(representative, "config", "--get-regexp", r"^branch\..*\.(remote|merge|rebase)$", allow_failure=True)
        if tracking:
            for line in tracking.decode().splitlines():
                key, value = line.split(" ", 1)
                repo["branchSettings"][key] = value
        original_refs = git(representative, "for-each-ref", "--format=%(objectname) %(refname)")
        repo["refsBeforeArchive"] = original_refs.decode().splitlines()
        anchors = []
        try:
            for tree in trees:
                relative = tree.relative_to(root).as_posix()
                state = package / "states" / tree.name
                state.mkdir()
                branch = git(tree, "symbolic-ref", "--short", "-q", "HEAD", allow_failure=True)
                head = git(tree, "rev-parse", "HEAD").decode().strip()
                item = {"path": relative, "head": head, "branch": branch.decode().strip() if branch else None,
                        "state": state.relative_to(package).as_posix(), "indexTree": git(tree, "write-tree").decode().strip()}
                git(tree, "diff", "--binary", "--cached", "--no-ext-diff", "--no-textconv", "--output=" + str(state / "staged.patch"), "HEAD")
                git(tree, "diff", "--binary", "--no-ext-diff", "--no-textconv", "--output=" + str(state / "unstaged.patch"))
                changed = set()
                for args in [("diff", "--name-only", "--no-renames", "HEAD", "-z"), ("diff", "--cached", "--name-only", "--no-renames", "-z"), ("diff", "--name-only", "--no-renames", "-z")]:
                    changed.update(names(git(tree, *args)))
                untracked = names(git(tree, "ls-files", "--others", "--exclude-standard", "-z"))
                included = sorted(changed | {n for n in untracked if not ignored(n)})
                manifest["excluded"].extend({"path": relative + "/" + n, "reason": "generated artifact/cache or local credential material"} for n in untracked if ignored(n) and not n.startswith("artifacts/"))
                entries = []
                item["files"] = {}
                for name in included:
                    p = tree / name
                    if p.is_symlink():
                        raise RuntimeError("Uncommitted source symlink requires explicit handling: " + str(p))
                    if p.is_file():
                        entries.append((p, name))
                    elif p.exists():
                        raise RuntimeError("Unexpected source path: " + str(p))
                    else:
                        item["files"][name] = None
                item["files"].update(save_zip(state / "working-files.zip", entries))
                (state / "status.txt").write_bytes(git(tree, "status", "--short"))
                anchor = "refs/portable-handoff/" + uuid.uuid4().hex + "/" + tree.name
                git(representative, "update-ref", anchor, head, "0" * 40)
                anchors.append((anchor, head))
                repo["worktrees"].append(item)
            git(representative, "bundle", "create", str(package / repo["bundle"]), "--all")
            git(representative, "bundle", "verify", str(package / repo["bundle"]))
            advertised = git(representative, "bundle", "list-heads", str(package / repo["bundle"])).decode()
            for anchor, head in anchors:
                if head + " " + anchor not in advertised:
                    raise RuntimeError("Detached/worktree HEAD missing from bundle")
        finally:
            for anchor, head in anchors:
                git(representative, "update-ref", "-d", anchor, head)
        if git(representative, "for-each-ref", "--format=%(objectname) %(refname)") != original_refs:
            raise RuntimeError("Original repository refs changed during snapshot")
        manifest["repositories"].append(repo)
    # Preserve the original Rust project's authored source, skills, tools and ALL
    # documentation, but not local provider/auth configuration or generated logs.
    entries = []
    for name in ["crates", "docs", "tools", ".opencode", ".github"]:
        entries.extend((p, p.relative_to(root).as_posix()) for p in walk(root / name) if p.suffix.lower() not in {".pyc", ".exe", ".pdb", ".dll"})
    for p in sorted(root.iterdir()):
        if p.is_file() and (p.suffix.lower() in {".md", ".toml", ".lock"} or p.name in {".gitignore", ".graphifyrc", ".graphifyignore"}):
            entries.append((p, p.relative_to(root).as_posix()))
    manifest["workspaceFiles"] = save_zip(package / manifest["workspaceArchive"], entries)
    evidence = []
    for directory in [root / "artifacts", *[t / "artifacts" for trees in groups.values() for t in trees]]:
        for p in walk(directory):
            if p.is_relative_to(build) or p.suffix.lower() not in EVIDENCE_EXT:
                continue
            evidence.append((p, p.relative_to(root).as_posix()))
    manifest["evidenceFiles"] = save_zip(package / manifest["evidenceArchive"], evidence)
    resources = [(p, p.relative_to(root).as_posix()) for p in sorted((root / "resources").iterdir()) if p.is_file()]
    manifest["resourceFiles"] = save_zip(package / manifest["resourcesArchive"], resources)
    for tree in sorted((root / "forks").iterdir()):
        if not tree.is_dir() or any(tree in trees for trees in groups.values()):
            continue
        entries = [(p, p.relative_to(tree).as_posix()) for p in walk(tree) if not ignored(p.relative_to(tree).as_posix())]
        if entries:
            name = "reference/" + tree.name + "-source.zip"
            save_zip(package / name, entries)
            manifest["legacyArchives"].append(name)
    manifest["excluded"].extend([
        {"path": "**/node_modules, **/target, **/dist, .tools, graphify-out", "reason": "reproducible dependencies/build caches/indexes"},
        {"path": "resources/<downloaded application version directories>", "reason": "old vendor distributions, not authored source or private project inputs"},
        {"path": "artifacts/**/*.exe, *.pdb, *.dll, bundled *.js/*.css", "reason": "old binaries/debug symbols/rebuildable browser bundles; current verified binaries remain in parent build folder"},
        {"path": "opencode.jsonc, ignored local credentials/settings", "reason": "machine-specific provider/auth configuration; reconfigure locally"},
    ])
    (package / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    script = Path(__file__).with_name("restore-portable-handoff.py")
    (package / "RESTORE.py").write_bytes(script.read_bytes())
    main = Path(__file__).resolve().parents[1]
    (package / "README.md").write_bytes((main / "docs/portable-handoff.md").read_bytes())
    # Readable knowledge index beside the compressed restore state. No need to
    # restore/build the applications merely to read decisions or the backlog.
    knowledge = package / "WISSEN"
    for p in walk(root / "docs"):
        target = knowledge / "laser_beam/docs" / p.relative_to(root / "docs")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)
    for p in root.iterdir():
        if p.is_file() and p.suffix.lower() == ".md":
            target = knowledge / "laser_beam" / p.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
    for p in walk(main / "docs"):
        target = knowledge / "kizamubeam/docs" / p.relative_to(main / "docs")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)
    for name in ["README.md", "README.de.md", "AGENTS.md", "CONTRIBUTING.md", "LICENSE", "NOTICE"]:
        p = main / name
        if p.is_file():
            shutil.copy2(p, knowledge / "kizamubeam" / name)
    states = [{k: tree[k] for k in ["path", "head", "branch", "indexTree"]} | {"savedChangedAndNewFiles": len(tree["files"])} for repo in manifest["repositories"] for tree in repo["worktrees"]]
    (knowledge / "PR-STAENDE.json").write_text(json.dumps(states, indent=2), encoding="utf-8")
    print(json.dumps({"package": str(package), "worktrees": sum(len(r["worktrees"]) for r in manifest["repositories"]), "repositories": len(groups), "knowledgeFiles": len(manifest["workspaceFiles"]), "evidenceFiles": len(manifest["evidenceFiles"]), "privateResources": len(resources)}, indent=2))
    print("Add README/checksums, then run a fresh offline restore before marking verified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--build", type=Path, required=True)
    args = parser.parse_args()
    create(args.root, args.build)
