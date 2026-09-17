# Documentation

Two kinds of document live here, and they are used differently.

## Implementing this

The deployment checklist — build, page hook, book build, headers, verification, rollback
— is in the top-level [`README.md`](../README.md) under *Putting it on a library*, with a
diagram of the build-time and read-time halves under *Workflow*.

**[`SPEAKING_MATHEMATICS.md`](SPEAKING_MATHEMATICS.md)** — the reference for speaking
equations and chemistry aloud, written for developers porting this to another stack. Each
rule is a string transformation over Speech Rule Engine's output, with the reason it
exists and the number of equations it fixes. **Read this before changing anything in
`pipeline/math_phrasing.py`.** It is explicit about the parts that are cheap to get wrong
and expensive to discover: which rules are safe unconditionally, why the subject has to
come from the book rather than the equation, why units must be an explicit list, and two
orderings that silently do nothing if reversed.
