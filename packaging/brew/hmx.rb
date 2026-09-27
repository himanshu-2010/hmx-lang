# hmx formula for the hmx Homebrew tap.
#
# Repo: github.com/himanshu-2010/homebrew-hmx  ->  Formula/hmx.rb
# Install with:
#   brew tap himanshu-2010/homebrew-hmx
#   brew install hmx
#
# Built from the source tag rather than a release tarball: the release only
# ships a macOS arm64 tarball, and Homebrew has to install on Intel Macs too.
# There is deliberately no `revision:` here -- it exists only to pin a tag that
# has been moved, and leaving a stale sha in place makes brew fail with a
# confusing "revision is no longer part of the repository" error. tests/
# run_packaging_tests.sh checks that `tag:` and the `hmx <version>` assertion
# agree with CMakeLists.
class Hmx < Formula
  desc "HMX — a small statically typed systems language that transpiles to C"
  homepage "https://github.com/himanshu-2010/hmx-lang"
  url "https://github.com/himanshu-2010/hmx-lang.git",
      tag: "v0.10.0"
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

  def caveats
    "hmx transpiles to C, so a C compiler (gcc, cc or clang) must be on PATH at runtime."
  end

  test do
    assert_match "hmx 0.10.0", shell_output("#{bin}/hmx --version")
  end
end
