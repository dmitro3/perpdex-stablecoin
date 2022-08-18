import "@nomiclabs/hardhat-waffle"
import "@nomicfoundation/hardhat-chai-matchers"
import "@typechain/hardhat"
import "solidity-coverage"
import "hardhat-deploy"
import "@matterlabs/hardhat-zksync-solc"
import { HardhatUserConfig } from "hardhat/config"
import { resolve } from "path"
import { config as dotenvConfig } from "dotenv"

dotenvConfig({ path: resolve(__dirname, "./.env") })

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.16",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    zksolc: {
        version: "0.1.0",
        compilerSource: "docker",
        settings: {
            optimizer: {
                enabled: true,
            },
            experimental: {
                dockerImage: "matterlabs/zksolc",
            },
        },
    },
    namedAccounts: {
        deployer: 0,
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
        },
    },
    typechain: {
        outDir: "typechain",
        // externalArtifacts: ['externalArtifacts/*.json'], // optional array of glob patterns with external artifacts to process (for example external libs from node_modules)
    },
}

if (process.env.TESTNET_PRIVATE_KEY) {
    if (process.env.INFURA_PROJECT_ID) {
        config.networks.rinkeby = {
            url: "https://rinkeby.infura.io/v3/" + process.env.INFURA_PROJECT_ID,
            accounts: [process.env.TESTNET_PRIVATE_KEY],
            gasMultiplier: 2,
        }
    }

    config.networks.mumbai = {
        url: "https://rpc-mumbai.maticvigil.com",
        accounts: [process.env.TESTNET_PRIVATE_KEY],
        gas: 2100000,
        gasPrice: 8000000000,
    }

    config.networks.fuji = {
        url: "https://api.avax-test.network/ext/bc/C/rpc",
        accounts: [process.env.TESTNET_PRIVATE_KEY],
        gasMultiplier: 2,
    }

    config.networks.shibuya = {
        url: "https://evm.shibuya.astar.network",
        chainId: 81,
        accounts: [process.env.TESTNET_PRIVATE_KEY],
        gasMultiplier: 2,
        verify: {
            etherscan: {
                apiUrl: "https://blockscout.com/shibuya",
            },
        },
    }

    config.networks.zksync2_testnet = {
        url: "https://zksync2-testnet.zksync.dev",
        chainId: 280,
        accounts: [process.env.TESTNET_PRIVATE_KEY],
        gasMultiplier: 2,
        verify: {
            etherscan: {
                apiUrl: "https://zksync2-testnet.zkscan.io/",
            },
        },
        zksync: true,
    }

    config.networks.optimism_kovan = {
        url: "https://kovan.optimism.io",
        accounts: [process.env.TESTNET_PRIVATE_KEY],
    }

    config.networks.arbitrum_rinkeby = {
        url: "https://rinkeby.arbitrum.io/rpc",
        accounts: [process.env.TESTNET_PRIVATE_KEY],
    }
}

export default config
