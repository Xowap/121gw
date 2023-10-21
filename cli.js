const deploy = require("./deploy");

const argv = require("yargs/yargs")(process.argv.slice(2))
    .option("branch", {
        alias: "b",
        description: "Branch to deploy",
        type: "string",
    })
    .option("commit", {
        alias: "c",
        description: "SHA of the deployed commit",
        type: "string",
    })
    .option("file", {
        alias: "f",
        description: "Fluxfile to use",
        type: "string",
    })
    .option("timeout", {
        alias: "t",
        description: "Timeout in seconds",
        default: 1800, // 30 minutes
        type: "number",
    })
    .help()
    .alias("help", "h").argv;

const FLUX_ENDPOINT = process.env.FLUX_ENDPOINT;
const FLUX_TOKEN = process.env.FLUX_TOKEN;

async function main() {
    if (!FLUX_ENDPOINT) {
        console.error("FLUX_ENDPOINT not set");
        process.exit(1);
    }

    if (!FLUX_TOKEN) {
        console.error("FLUX_TOKEN not set");
        process.exit(1);
    }

    let ret = 1;

    try {
        await deploy({
            endpoint: FLUX_ENDPOINT,
            token: FLUX_TOKEN,
            file: argv.file,
            timeout: argv.timeout,
            branch: argv.branch,
            commit: argv.commit,
        });

        ret = 0;
    } catch (error) {
        if (!error.noDisplay) {
            console.error(error);
        }
    }

    process.exit(ret);
}

main().then();
