const core = require("@actions/core");
const deploy = require("./deploy");

async function run() {
    try {
        await deploy({
            endpoint: core.getInput("endpoint"),
            token: core.getInput("token"),
            file: core.getInput("file"),
            timeout: core.getInput("timeout"),
            branch: core.getInput("branch"),
        });
    } catch (error) {
        core.setFailed(error.message);
    }
}

run();
