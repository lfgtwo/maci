import * as ethers from 'ethers'
import * as fs from 'fs'

import {
    maciContractAbi,
    formatProofForVerifierContract,
} from 'maci-contracts'

import {
    genBatchUstProofAndPublicSignals,
    verifyBatchUstProof,
    getSignalByNameViaSym,
} from 'maci-circuits'

import {
    PubKey,
    Message,
} from 'maci-domainobjs'

import {
    delay,
    promptPwd,
    validateEthSk,
    validateEthAddress,
    contractExists,
    genMaciStateFromContract,
    checkDeployerProviderConnection,
} from './utils'

import {
    DEFAULT_ETH_PROVIDER,
} from './defaults'

const configureSubparser = (subparsers: any) => {
    const parser = subparsers.addParser(
        'replay',
        { addHelp: true },
    )

    parser.addArgument(
        ['-e', '--eth-provider'],
        {
            action: 'store',
            type: 'string',
            help: `A connection string to an Ethereum provider. Default: ${DEFAULT_ETH_PROVIDER}`,
        }
    )

    const ethPrivkeyGroup = parser.addMutuallyExclusiveGroup({ required: true })

    ethPrivkeyGroup.addArgument(
        ['-dp', '--prompt-for-eth-privkey'],
        {
            action: 'storeTrue',
            help: 'Whether to prompt for the user\'s Ethereum private key and ignore -d / --eth-privkey',
        }
    )

    ethPrivkeyGroup.addArgument(
        ['-d', '--eth-privkey'],
        {
            action: 'store',
            type: 'string',
            help: 'The deployer\'s Ethereum private key',
        }
    )

    parser.addArgument(
        ['-x', '--contract'],
        {
            required: true,
            type: 'string',
            help: 'The MACI contract address',
        }
    )

    parser.addArgument(
        ['-o', '--data-file'],
        {
            required: true,
            type: 'string',
            help: 'The JSON file generated by the download subcommand',
        }
    )
}

const replay = async (args: any) => {
    // MACI contract
    if (!validateEthAddress(args.contract)) {
        console.error('Error: invalid MACI contract address')
        return
    }

    let ethSk
    // The coordinator's Ethereum private key
    // The user may either enter it as a command-line option or via the
    // standard input
    if (args.prompt_for_eth_privkey) {
        ethSk = await promptPwd('Your Ethereum private key')
    } else {
        ethSk = args.eth_privkey
    }

    if (ethSk.startsWith('0x')) {
        ethSk = ethSk.slice(2)
    }

    if (!validateEthSk(ethSk)) {
        console.error('Error: invalid Ethereum private key')
        return
    }

    // Ethereum provider
    const ethProvider = args.eth_provider ? args.eth_provider : DEFAULT_ETH_PROVIDER

    if (! (await checkDeployerProviderConnection(ethSk, ethProvider))) {
        console.error('Error: unable to connect to the Ethereum provider at', ethProvider)
        return
    }

    const provider = new ethers.providers.JsonRpcProvider(ethProvider)

    const wallet = new ethers.Wallet(ethSk, provider)

    const maciAddress = args.contract

    if (! (await contractExists(provider, maciAddress))) {
        console.error('Error: there is no contract deployed at the specified address')
        return
    }

    const maciContract = new ethers.Contract(
        maciAddress,
        maciContractAbi,
        wallet,
    )

    // Check that the contract is ready to accept signups and messages.
    // This command does not support resuming
    const numMessages = Number(await maciContract.numMessages())
    const numSignUps = Number(await maciContract.numSignUps())

    if (numSignUps !== 0 && numMessages !== 0) {
        console.error('Error: the contract must have no signups or messages.')
        return
    }

    // Read the data file
    const data = JSON.parse(fs.readFileSync(args.data_file).toString())

    let i = 1
    for (const user of data.users) {
        console.log(`Signing up ${i} / ${data.users.length}`)
        const pubKey = PubKey.unserialize(user.pubKey)
        const voiceCreditBalance = '0x' + BigInt(user.voiceCreditBalance).toString(16)
        const tx = await maciContract.signUp(
            pubKey.asContractParam(),
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            ethers.utils.defaultAbiCoder.encode(['uint256'], [voiceCreditBalance]),
            { gasLimit: 2000000 },
        )
        await tx.wait()
        i ++
    }

    i = 1
    for (const message of data.messages) {
        console.log(`Publishing message ${i} / ${data.messages.length}`)
        const encPubKey = PubKey.unserialize(message.encPubKey)
        const iv = BigInt(message.iv)
        const d = message.data.map((x) => BigInt(x))
        const m = new Message(iv, d)

        const tx = await maciContract.publishMessage(
            m.asContractParam(),
            encPubKey.asContractParam(),
            { gasLimit: 1000000 }
        )

        await tx.wait()
        i ++
    }

    const stateRoot = await maciContract.getStateTreeRoot()
    const messageRoot = await maciContract.getMessageTreeRoot()
    console.log('state root:', BigInt(stateRoot).toString(16))
    console.log('message root:', BigInt(messageRoot).toString(16))
}

export {
    replay,
    configureSubparser,
}