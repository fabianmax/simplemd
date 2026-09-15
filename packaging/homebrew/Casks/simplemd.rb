# Homebrew cask for simplemd — SCAFFOLD, NOT PUBLISHED.
#
# This file is not live. Publishing it needs two things that are not true yet:
#
#   1. A public repo. Cask `url` fetches a GitHub release asset; on a private
#      repo that asset is private too and `brew install` 404s for everyone.
#   2. A notarized DMG. Without it every installer hits Gatekeeper, which is the
#      entire reason to prefer a cask over "download and drag".
#
# To publish once both hold: create a public repo `fabianmax/homebrew-tap`, copy
# this file to `Casks/simplemd.rb` in it, fill in `version` and `sha256` from the
# release workflow's output, then `brew install fabianmax/tap/simplemd`.
#
# The `binary` stanza points inside the .app on purpose: notarization cannot
# staple a standalone binary, so the CLI ships within the bundle and Homebrew
# symlinks it onto PATH. This is BBEdit's shape.
cask "simplemd" do
  version "0.0.0"                       # TODO: match the release tag
  sha256 "0" * 64                       # TODO: shasum -a 256 of the released DMG

  url "https://github.com/fabianmax/simplemd/releases/download/v#{version}/simplemd_#{version}_aarch64.dmg"
  name "simplemd"
  desc "Markdown viewer/editor for working alongside coding agents"
  homepage "https://github.com/fabianmax/simplemd"

  depends_on macos: ">= :big_sur"       # LSMinimumSystemVersion 11.0
  depends_on arch: :arm64               # Apple Silicon native, not universal

  app "simplemd.app"
  binary "#{appdir}/simplemd.app/Contents/Helpers/simplemd"

  zap trash: [
    "~/Library/Application Support/com.fabianmueller.simplemd",
    "~/Library/Caches/com.fabianmueller.simplemd",
    "~/Library/Preferences/com.fabianmueller.simplemd.plist",
    "~/Library/Saved Application State/com.fabianmueller.simplemd.savedState",
    "~/Library/WebKit/com.fabianmueller.simplemd",
  ]
end
