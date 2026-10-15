# Architecture

## Try the engine

The formula engine has a small REPL (no UI needed):

```bash
printf '=SUM(1,2,3)*2\nA1 = 5\nB1 = =A1*2\n=B1+1\n' | cargo run -q -p engine-formula --example repl
```

prints `12`, `5`, `10`, `11`. `=...` evaluates a formula in a scratch cell, `A1 = 5` / `B2 = =A1*2` / `Sheet2!C3 = hello` assign cells (dependents are recalculated and listed as `(also: ...)`), `:sheet Name` adds a sheet, `:show` lists all assigned cells, `:help` and `:q` do what they say.
