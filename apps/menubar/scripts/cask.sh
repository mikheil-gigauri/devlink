#!/usr/bin/env bash
# Prints the Homebrew cask for a released Devlink.app zip: scripts/cask.sh <version> <sha256>.
# The release workflow writes it to Casks/devlink.rb in the tap repository.
set -euo pipefail
version="$1"
sha256="$2"
cat <<RUBY
cask "devlink" do
  version "$version"
  sha256 "$sha256"

  url "https://github.com/mikheil-gigauri/devlink/releases/download/%40gigauri96/devlink%40#{version}/Devlink-#{version}.zip"
  name "devlink"
  desc "Menu bar app for testing unreleased npm libraries in real apps"
  homepage "https://mikheil-gigauri.github.io/devlink/"

  depends_on macos: ">= :sonoma"

  app "Devlink.app"

  zap trash: "~/Library/Preferences/dev.devlink.menubar.plist"

  caveats <<~EOS
    The menu bar app drives the devlink command-line tool. Install it with:
      npm install --global @gigauri96/devlink
  EOS
end
RUBY
