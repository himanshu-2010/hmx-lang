import { CodeBlock } from "./CodeBlock";
import "./pages.css";

/**
 * The licence text is a copy of the repository's LICENSE, and the packaging gate
 * compares them byte for byte.
 *
 * A licence page that quietly disagrees with the LICENSE file is worse than no
 * page at all: it is the one document where a reader has no way to tell which of
 * the two they are looking at, and "the website says MIT" is a perfectly good
 * reason to skip reading the file that actually governs. So this is a copy, not a
 * paraphrase, and the gate exists because a paraphrase is exactly the kind of
 * change nobody makes deliberately.
 */
const LICENSE_TEXT = `MIT License

Copyright (c) 2026 Himanshu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function LicensePage() {
  return (
    <main className="page">
      <div className="page-inner">
        <span className="page-eyebrow">Terms</span>
        <h1 className="page-title">License</h1>
        <p className="page-lede">
          hmx is released under the MIT License. It is a permissive licence: you
          can use it, modify it, ship it, and use it commercially, including inside
          closed-source software. The one obligation is the notice below.
        </p>

        <div className="page-note">
          <strong>This is a copy, not a summary.</strong> It is byte-for-byte the{" "}
          <code>LICENSE</code> in the repository, and a packaging gate fails the
          build if the two ever diverge. Read the file if you are relying on it:
          <a href="https://github.com/himanshu-2010/hmx-lang/blob/main/LICENSE" target="_blank" rel="noreferrer">
            {" "}github.com/himanshu-2010/hmx-lang/blob/main/LICENSE
          </a>
          .
        </div>

        <h2 className="page-h2">The licence</h2>
        <CodeBlock label="LICENSE" code={LICENSE_TEXT} />

        <h2 className="page-h2">In practice</h2>
        <ul className="page-ul">
          <li className="page-li">
            <strong>Do:</strong> anything you like, including commercially and in
            proprietary products.
          </li>
          <li className="page-li">
            <strong>Keep:</strong> the copyright notice and the permission notice
            in copies or substantial portions of the software.
          </li>
          <li className="page-li">
            <strong>No warranty:</strong> the software is provided as-is, without
            warranty of any kind. That is the standard MIT disclaimer, not a
            comment on how stable hmx is.
          </li>
        </ul>

        <p className="page-note">
          The compiler generates C, which it then hands to your system C compiler.
          The generated code carries no licence obligation of its own, but it is
          your code once written — including any code it produced from an hmx
          program you wrote.
        </p>

        <h2 className="page-h2">Reporting a vulnerability</h2>
        <p className="page-p">
          Security issues are worth raising privately rather than in a public
          issue. Open a GitHub security advisory on{" "}
          <a href="https://github.com/himanshu-2010/hmx-lang" target="_blank" rel="noreferrer">
            the repository
          </a>{" "}
          if that is available to you, or email{" "}
          <a href="mailto:himanshujsr462@gmail.com">himanshujsr462@gmail.com</a>.
        </p>
      </div>
    </main>
  );
}