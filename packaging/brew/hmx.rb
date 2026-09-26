# hmx formula for the hmx Homebrew tap.
#
# Repo: github.com/himanshu-2010/homebrew-hmx  →  Formula/hmx.rb
# Install with:
#   brew tap himanshu-2010/homebrew-hmx
#   brew install hmx
#
# The `revision` must point at the v0.9.0 tag commit; it is stamped by
# the release tooling (see .github/workflows/release.yml / install docs).
class Hmx < Formula
  desc "HMX — a small statically typed systems language that transpiles to C"
  homepage "https://github.com/himanshu-2010/hmx-lang"
  url "https://github.com/himanshu-2010/hmx-lang.git",
      tag:      "v0.9.0",
      revision: "20e3a256b4fc659ed21594e385e8d030e5da7b9a"
  license "MIT"
  head "https://github.com/himanshu-2010/hmx-lang.git", branch: "main"

  depends_on "cmake" => :build
  depends_on "bison" => :build
  depends_on "flex" => :build
  depends_on "gcc"

  def install
    system "cmake", "-S", ".", "-B", "build", "-DCMAKE_BUILD_TYPE=Release"
    system "cmake", "--build", "build"
    system "cmake", "--install", "build", "--prefix", prefix
  end

  test do
    assert_match "hmx 0.9.0", shell_output("#{bin}/hmx --version")
  end
end