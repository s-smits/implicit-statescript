# Third-party notices

implicit-statescript is MIT-licensed (see `LICENSE`). Parts of it are ported from the projects
below, whose licences require their notices to travel with the copies.

## rust-clippy

- Source: https://github.com/rust-lang/rust-clippy, `clippy_lints/src/excessive_bools.rs` at
  commit 146674f (`struct_excessive_bools` and `fn_params_excessive_bools`), dual-licensed MIT or
  Apache-2.0; this port takes it under MIT.
- Port: `src/rules/prefer-state-union.ts`, TypeScript over Oxlint's ESTree. Local changes: a record
  is an interface, an object type literal or a class rather than a struct; a flag is a required
  member typed `boolean`, `true` or `false` (with `undefined` or `null` beside it) or a class field
  initialised to a boolean, where Clippy counts every `bool` field; optional members and
  declaration files are not read; the boolean `useState` cells of one function count as a record;
  `params: null` leaves the function half to another rule. Clippy's defaults (more than 3 of each)
  are kept, and its exemption for `#[repr(C)]` structs has no TypeScript counterpart.

```text
MIT License

Copyright (c) The Rust Project Contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## rust-excessive-bools-lint

- Source: https://github.com/mitsuhiko/rust-excessive-bools-lint, `src/lib.rs` at commit 0f95d16,
  the lint Clippy's `excessive_bools` grew from.
- Port: the same `src/rules/prefer-state-union.ts`, which follows Clippy's later form; from this
  original it keeps the argument that several booleans on one record are one state spelled as
  flags, and the advice to name the states instead.

```text
Copyright (c) 2014 by Armin Ronacher.

Some rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.

    * Redistributions in binary form must reproduce the above
      copyright notice, this list of conditions and the following
      disclaimer in the documentation and/or other materials provided
      with the distribution.

    * The names of the contributors may not be used to endorse or
      promote products derived from this software without specific
      prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## foxglove eslint-plugin

- Source: https://github.com/foxglove/eslint-plugin, `rules/no-boolean-parameters.js` at commit
  e381b5a, MIT.
- Port: its reading of which annotation and which parameter hold a flag, in `src/shared/flags.ts`,
  through which `prefer-state-union` counts flag parameters. Local changes: the type checker's union
  parts become the written annotation (`boolean`, `true` or `false`, beside `undefined`, `null` or
  `void`) and a default of `true` or `false`; the rule's own reporting, options and suggestions are
  not taken.

```text
MIT License

Copyright (c) Foxglove Technologies Inc

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
SOFTWARE.
```
