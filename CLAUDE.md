# Everside app

Before reading code, open `graphify-out/GRAPH_REPORT.md`. It maps the codebase: the main parts, how they connect, and which files hold what. Use it to find the files you need, then read only those.

`graphify-out/graph.json` has the full graph if you need to trace a connection. `graphify-out/graph.html` is the same graph to explore in a browser.

The app code lives in `src/`. `index.html` loads `src/main.jsx`, which imports `src/App.jsx`. Do not add copies of app files at the top level of the repo.

The graph was built on 25 Nov 2026. If the code has changed a lot since then, rebuild it with graphify.
