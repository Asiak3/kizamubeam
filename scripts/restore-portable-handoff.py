"""Offline restore of the private portable development package; never overwrites work."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import zipfile


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def git(directory, *args):
    result = subprocess.run(["git", "-C", str(directory), *map(str, args)], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", "replace"))
    return result.stdout


def extract(archive, destination):
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            p = PurePosixPath(entry.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in entry.filename or ":" in entry.filename:
                raise RuntimeError("Unsafe archive entry: " + entry.filename)
            target = destination.joinpath(*p.parts)
            if not target.resolve().is_relative_to(destination):
                raise RuntimeError("Archive escapes destination")
        z.extractall(destination)


def restore(package, destination):
    package, destination = package.resolve(), destination.resolve()
    if destination.exists():
        raise RuntimeError("Destination already exists. Choose a NEW directory; nothing was overwritten.")
    checks = json.loads((package / "checksums.json").read_text(encoding="utf-8"))
    for name, expected in checks.items():
        if sha(package / name) != expected["sha256"]:
            raise RuntimeError("Package checksum mismatch: " + name)
    manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
    destination.mkdir(parents=True)
    extract(package / manifest["workspaceArchive"], destination)
    restored = []
    for repo in manifest["repositories"]:
        storage = destination / ".git-storage" / (repo["id"] + ".git")
        storage.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(["git", "clone", "--mirror", str(package / repo["bundle"]), str(storage)], capture_output=True)
        if result.returncode:
            raise RuntimeError(result.stderr.decode("utf-8", "replace"))
        git(storage, "config", "--remove-section", "remote.origin")
        git(storage, "remote", "add", "origin", "https://github.com/liquid-light/kizamubeam.git")
        git(storage, "remote", "add", "upstream", "https://github.com/negurvulkan/kizamubeam.git")
        git(storage, "config", "pull.ff", "only")
        for name, value in repo["gitSettings"].items():
            git(storage, "config", name, value)
        for name, value in repo.get("branchSettings", {}).items():
            git(storage, "config", name, value)
        for tree in repo["worktrees"]:
            target = destination / tree["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if tree["branch"]:
                git(storage, "worktree", "add", str(target), tree["branch"])
            else:
                git(storage, "worktree", "add", "--detach", str(target), tree["head"])
            state = package / tree["state"]
            for name, options in [("staged.patch", ["--index"]), ("unstaged.patch", [])]:
                patch = state / name
                if patch.stat().st_size:
                    git(target, "apply", "--binary", *options, str(patch))
            extract(state / "working-files.zip", target)
            if git(target, "rev-parse", "HEAD").decode().strip() != tree["head"]:
                raise RuntimeError("Restored HEAD mismatch: " + tree["path"])
            if git(target, "write-tree").decode().strip() != tree["indexTree"]:
                raise RuntimeError("Restored staging area mismatch: " + tree["path"])
            for name, expected in tree["files"].items():
                p = target / name
                if expected is None:
                    if p.exists():
                        raise RuntimeError("Deleted source reappeared: " + str(p))
                elif not p.is_file() or sha(p) != expected:
                    raise RuntimeError("Restored file mismatch: " + str(p))
            restored.append(tree["path"])
        clean = destination / "forks/kizamubeam-upstream"
        branch = "handoff/upstream-main"
        git(storage, "branch", branch, "refs/remotes/upstream/main")
        git(storage, "worktree", "add", str(clean), branch)
        git(clean, "branch", "--set-upstream-to=upstream/main", branch)
        if git(clean, "status", "--porcelain"):
            raise RuntimeError("Upstream checkout is not clean")
    extract(package / manifest["evidenceArchive"], destination)
    extract(package / manifest["resourcesArchive"], destination)
    for name, expected in manifest["workspaceFiles"].items():
        if sha(destination / name) != expected:
            raise RuntimeError("Knowledge/source restore mismatch: " + name)
    for name, expected in manifest["resourceFiles"].items():
        if sha(destination / name) != expected:
            raise RuntimeError("Resource restore mismatch: " + name)
    for name, expected in manifest["evidenceFiles"].items():
        if sha(destination / name) != expected:
            raise RuntimeError("Evidence restore mismatch: " + name)
    # Keep compact, non-Git historical source snapshots for reference, not as
    # active worktrees. Dependencies/binaries are deliberately not restored.
    reference = destination / "reference"
    reference.mkdir(exist_ok=True)
    for name in manifest["legacyArchives"]:
        import shutil
        shutil.copy2(package / name, reference / Path(name).name)
    (destination / "START-HERE.md").write_text((package / "README.md").read_text(encoding="utf-8"), encoding="utf-8")
    report = {"restoredWorktrees": restored, "sourceIndexResourceEvidenceHashesVerified": True,
              "upstreamCheckout": "forks/kizamubeam-upstream", "networkUsed": False,
              "originalRepositoriesModified": False}
    (destination / "RESTORE-RESULT.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(restore(args.package, args.destination), indent=2))
