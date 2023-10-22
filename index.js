const core = require("@actions/core");
const github = require("@actions/github");
const deploy = require("./deploy");

async function run() {
    let branch = core.getInput("branch");

    if (!branch) {
        branch = github.context.ref.replace("refs/heads/", "");
    }

    let ret = 1;

    try {
        const context = {
            endpoint: core.getInput("endpoint"),
            token: core.getInput("token"),
            file: core.getInput("file"),
            timeout: parseInt(core.getInput("timeout"), 10),
            branch: branch,
            commit: github.context.sha,
        };
        console.log(context);
        await deploy(context);

        ret = 0;
    } catch (error) {
        core.setFailed(error);
    }

    process.exit(ret);
}

console.log("crash crash burn");

process.exit(1);

run().then();
