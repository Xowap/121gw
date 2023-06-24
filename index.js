const core = require("@actions/core");
const github = require("@actions/github");
const deploy = require("./deploy");

async function run() {
    let branch = core.getInput("branch");

    if (!branch) {
        branch = github.context.ref.replace("refs/heads/", "");
    }

    try {
        await deploy({
            endpoint: core.getInput("endpoint"),
            token: core.getInput("token"),
            file: core.getInput("file"),
            timeout: parseInt(core.getInput("timeout"), 10),
            branch: branch,
        });
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
