require('module-alias/register')
import * as ethers from 'ethers'
import * as argparse from 'argparse' 
import * as fs from 'fs' 
import * as path from 'path'
import * as etherlime from 'etherlime-lib'
import { config } from 'maci-config'
import { genAccounts, genTestAccounts } from './accounts'
const MiMC = require('@maci-contracts/compiled/MiMC.json')
const Hasher = require('@maci-contracts/compiled/Hasher.json')
const SignUpToken = require('@maci-contracts/compiled/SignUpToken.json')

const BatchUpdateStateTreeVerifier = require('@maci-contracts/compiled/BatchUpdateStateTreeVerifier.json')
const MerkleTree = require('@maci-contracts/compiled/MerkleTree.json')
const MACI = require('@maci-contracts/compiled/MACI.json')

const getDeployer = (
    privateKey: string,
) => {
    return new etherlime.JSONRPCPrivateKeyDeployer(
        privateKey,
        config.get('chain.url'),
        {
            gasLimit: 8800000,
        },
    )
}

const deploySignupToken = async (deployer) => {
    console.log('Deploying SignUpToken')
    const signUpTokenContract = await deployer.deploy(SignUpToken, {})

    return signUpTokenContract
}

const deployMaci = async (
    deployer,
    signUpTokenAddress: string,
) => {
    console.log('Deploying MiMC')
    const mimcContract = await deployer.deploy(MiMC, {})

    console.log('Deploying Hasher')
    const hasherContract = await deployer.deploy(Hasher, { CircomLib: mimcContract.contractAddress })

    console.log('Deploying BatchUpdateStateTreeVerifier')
    const batchUpdateStateTreeVerifierContract = await deployer.deploy(BatchUpdateStateTreeVerifier, {})

    console.log('Deploying Command Tree')
    const commandTreeContract = await deployer.deploy(
        MerkleTree,
        {},
        config.merkleTrees.commandTreeDepth,
        hasherContract.contractAddress,
    )

    console.log('Deploying State Tree')
    const stateTreeContract = await deployer.deploy(
        MerkleTree,
        {},
        config.merkleTrees.stateTreeDepth,
        hasherContract.contractAddress,
    )

    console.log('Deploying MACI')
    const maciContract = await deployer.deploy(
        MACI,
        {},
        commandTreeContract.contractAddress,
        stateTreeContract.contractAddress,
        hasherContract.contractAddress,
        batchUpdateStateTreeVerifierContract.contractAddress,
        signUpTokenAddress,
        config.maci.signupDurationInBlocks.toString(),
        config.maci.coordinatorPublicKey[0].toString(),
        config.maci.coordinatorPublicKey[1].toString(),
    )

    console.log('Whitelisting the MACI contract in the Merkle trees')
    let tx = await commandTreeContract.whitelistAddress(maciContract.contractAddress)
    await tx.wait()

    tx = await commandTreeContract.whitelistAddress(maciContract.contractAddress)
    await tx.wait()

    return {
        mimcContract,
        hasherContract,
        batchUpdateStateTreeVerifierContract,
        commandTreeContract,
        stateTreeContract,
        maciContract,
    }
}

const main = async () => {
    let accounts
    if (config.env === 'local-dev' || config.env === 'test') {
        accounts = genTestAccounts()
    } else {
        accounts = genAccounts()
    }
    const admin = accounts[0]

    console.log('Using account', admin.address)

    const parser = new argparse.ArgumentParser({ 
        description: 'Deploy all contracts to an Ethereum network of your choice'
    })

    parser.addArgument(
        ['-o', '--output'],
        {
            help: 'The filepath to save the addresses of the deployed contracts',
            required: true
        }
    )

    parser.addArgument(
        ['-s', '--signUpToken'],
        {
            help: 'The address of the signup token (e.g. POAP)',
            required: false
        }
    )

    const args = parser.parseArgs()
    const outputAddressFile = args.output
    const signUpToken = args.signUpToken

    const deployer = new etherlime.JSONRPCPrivateKeyDeployer(
        admin.privateKey,
        config.chain.url,
        {
            gasLimit: 8800000,
        },
    )


    let signUpTokenAddress
    if (signUpToken) {
        signUpTokenAddress = signUpToken
    } else {
        const signUpTokenContract = await deploySignupToken(deployer)
        signUpTokenAddress = signUpTokenContract.contractAddress
    }

    const {
        mimcContract,
        hasherContract,
        batchUpdateStateTreeVerifierContract,
        commandTreeContract,
        stateTreeContract,
        maciContract,
    } = await deployMaci(
        deployer,
        signUpTokenAddress,
    )

    const addresses = {
        MiMC: mimcContract.contractAddress,
        Hasher: hasherContract.contractAddress,
        BatchUpdateStateTreeVerifier: batchUpdateStateTreeVerifierContract.contractAddress,
        CommandTree: commandTreeContract.contractAddress,
        StateTree: stateTreeContract.contractAddress,
        MACI: maciContract.contractAddress,
    }

    const addressJsonPath = path.join(__dirname, '..', outputAddressFile)
    fs.writeFileSync(
        addressJsonPath,
        JSON.stringify(addresses),
    )

    console.log(addresses)
}

if (require.main === module) {
    try {
        main()
    } catch (err) {
        console.error(err)
    }
}

export {
    deployMaci,
    deploySignupToken,
    getDeployer,
}
