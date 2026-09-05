# CreepJS test pages — vendored, unmodified

`timezone.html`, `timezone.js`, `workers.html`, `workers.js` are copied byte for byte from

    https://github.com/abrahamjuliot/creepjs  —  docs/tests/
    fetched 2026-09-03

CreepJS is MIT-licensed; the copyright is Abraham Juliot's, not this project's.

They are here so that `test/creepjs.mjs` runs **their** checks rather than a paraphrase of
them. That is the whole point: every other suite in `test/` asks whether this build
contradicts itself, and on 2026-09-03 a defect walked past all thirty-eight of them —
`timezone.html` said `reported location: Europe/Tallinn fake` in the user's own browser
because the zone model applied 2026's daylight-saving rule to the year 1113.

**Never edit these files.** An edited copy would be this project marking its own homework.
To refresh them, replace all four wholesale, run `node test/creepjs.mjs`, and read what
changed. They are excluded from the linter (`eslint.config.js`) and from the packed
extension (`tools/pack.mjs` drops all of `test/`).
