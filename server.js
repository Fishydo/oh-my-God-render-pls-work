const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const simpleGit = require("simple-git");
const httpProxy = require("http-proxy");

const app = express();
const proxy = httpProxy.createProxyServer({});
const PORT = process.env.PORT || 3000;

const projects = {};

app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

function randomId() {
  return Math.random().toString(36).substring(2, 10);
}

function nextPort() {
  return 4000 + Object.keys(projects).length;
}

/* ---------------- STATIC DEPLOY ---------------- */

app.post("/deploy/static", async (req, res) => {
  const id = randomId();
  const projectPath = path.join(__dirname, "projects", id);

  await fs.ensureDir(projectPath);

  for (const file of req.body.files) {
    await fs.outputFile(
      path.join(projectPath, file.name),
      file.content
    );
  }

  projects[id] = { type: "static", path: projectPath };

  res.json({ url: `/p/${id}/index.html` });
});

/* ---------------- NODE DEPLOY ---------------- */

app.post("/deploy/node", async (req, res) => {
  const id = randomId();
  const projectPath = path.join(__dirname, "projects", id);

  await fs.ensureDir(projectPath);

  for (const file of req.body.files) {
    await fs.outputFile(
      path.join(projectPath, file.name),
      file.content
    );
  }

  const port = nextPort();

  if (req.body.build && req.body.build.trim() !== "") {
    await new Promise((resolve, reject) => {
      const build = spawn(req.body.build, {
        cwd: projectPath,
        shell: true
      });

      build.on("close", code => {
        if (code === 0) resolve();
        else reject();
      });
    });
  }

  const child = spawn(req.body.start || "node server.js", {
    cwd: projectPath,
    shell: true,
    env: { ...process.env, PORT: port }
  });

  projects[id] = {
    type: "node",
    port,
    process: child
  };

  res.json({ url: `/p/${id}` });
});

/* ---------------- REPO DEPLOY ---------------- */

app.post("/deploy/repo", async (req, res) => {
  const id = randomId();
  const projectPath = path.join(__dirname, "projects", id);

  await simpleGit().clone(req.body.repo, projectPath);

  const port = nextPort();

  if (req.body.build) {
    await new Promise((resolve, reject) => {
      const build = spawn(req.body.build, {
        cwd: projectPath,
        shell: true
      });

      build.on("close", code => {
        if (code === 0) resolve();
        else reject();
      });
    });
  }

  const child = spawn(req.body.start || "npm start", {
    cwd: projectPath,
    shell: true,
    env: { ...process.env, PORT: port }
  });

  projects[id] = {
    type: "node",
    port,
    process: child
  };

  res.json({ url: `/p/${id}` });
});

/* ---------------- ROUTING ---------------- */

app.use("/p/:id", async (req, res) => {
  const id = req.params.id;
  const project = projects[id];

  if (!project) {
    return res.status(404).send("Project not found");
  }

  if (project.type === "static") {
    return express.static(project.path)(req, res);
  }

  proxy.web(req, res, {
    target: `http://localhost:${project.port}`
  });
});

app.listen(PORT, () => {
  console.log("InstaDeploy running on port", PORT);
});
