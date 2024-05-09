import { Injectable } from "@nestjs/common";
import hre from "hardhat";
import { Deployment, EContracts, ProofGenerator, type Poll, type MACI, type AccQueue } from "maci-contracts";
import { Keypair, PrivKey } from "maci-domainobjs";

import fs from "fs";
import path from "path";

import type { IGenerateArgs, IGenerateData } from "./types";

import { CryptoService } from "../crypto/crypto.service";

/**
 * ProofGeneratorService is responsible for generating message processing and tally proofs.
 */
@Injectable()
export class ProofGeneratorService {
  /**
   * Deployment helper
   */
  private deployment: Deployment;

  /**
   * CryptoService for user sensitive data decryption
   */
  private cryptoService: CryptoService;

  /**
   * Proof generator initialization
   */
  constructor() {
    this.deployment = Deployment.getInstance(hre);
    this.deployment.setHre(hre);
    this.cryptoService = CryptoService.getInstance();
  }

  /**
   * Generate proofs for message processing and tally
   *
   * @param args - generate proofs arguments
   * @returns - generated proofs for message processing and tally
   */
  async generate({
    poll,
    maciContractAddress,
    tallyContractAddress,
    useQuadraticVoting,
    encryptedCoordinatorPrivateKey,
    startBlock,
    endBlock,
    blocksPerBatch,
  }: IGenerateArgs): Promise<IGenerateData> {
    const maciContract = await this.deployment.getContract<MACI>({
      name: EContracts.MACI,
      address: maciContractAddress,
    });

    const signer = await this.deployment.getDeployer();
    const pollAddress = await maciContract.polls(poll);
    const pollContract = await this.deployment.getContract<Poll>({ name: EContracts.Poll, address: pollAddress });
    const { messageAq: messageAqAddress } = await pollContract.extContracts();
    const messageAq = await this.deployment.getContract<AccQueue>({
      name: EContracts.AccQueue,
      address: messageAqAddress,
    });

    const isStateAqMerged = await pollContract.stateAqMerged();

    if (!isStateAqMerged) {
      throw new Error("The state tree has not been merged yet. Please use the mergeSignups subcommmand to do so.");
    }

    const messageTreeDepth = await pollContract.treeDepths().then((depths) => Number(depths[2]));

    const mainRoot = await messageAq.getMainRoot(messageTreeDepth.toString());

    if (mainRoot.toString() === "0") {
      throw new Error("The message tree has not been merged yet. Please use the mergeMessages subcommmand to do so.");
    }

    const privateKey = await fs.promises.readFile(path.resolve(process.env.COORDINATOR_PRIVATE_KEY_PATH!));
    const maciPrivateKey = PrivKey.deserialize(this.cryptoService.decrypt(privateKey, encryptedCoordinatorPrivateKey));
    const coordinatorKeypair = new Keypair(maciPrivateKey);
    const maciState = await ProofGenerator.prepareState({
      maciContract,
      pollContract,
      messageAq,
      maciPrivateKey,
      coordinatorKeypair,
      pollId: poll,
      signer,
      options: {
        startBlock,
        endBlock,
        blocksPerBatch,
      },
    });

    const foundPoll = maciState.polls.get(BigInt(poll));

    if (!foundPoll) {
      throw new Error(`Poll ${poll} not found`);
    }

    const proofGenerator = new ProofGenerator({
      poll: foundPoll,
      maciContractAddress,
      tallyContractAddress,
      tally: this.getZkeyFiles(process.env.COORDINATOR_TALLY_ZKEY_NAME!, useQuadraticVoting),
      mp: this.getZkeyFiles(process.env.COORDINATOR_MESSAGE_PROCESS_ZKEY_NAME!, useQuadraticVoting),
      rapidsnark: process.env.COORDINATOR_RAPIDSNARK_EXE,
      outputDir: path.resolve("./proofs"),
      tallyOutputFile: path.resolve("./tally.json"),
      useQuadraticVoting,
    });

    const processProofs = await proofGenerator.generateMpProofs();
    const { proofs: tallyProofs, tallyData } = await proofGenerator.generateTallyProofs(hre.network);

    return {
      processProofs,
      tallyProofs,
      tallyData,
    };
  }

  /**
   * Get zkey, wasm and witgen filepaths for zkey set
   *
   * @param name - zkey set name
   * @param useQuadraticVoting - whether to use Qv or NonQv
   * @returns zkey and wasm filepaths
   */
  private getZkeyFiles(name: string, useQuadraticVoting: boolean): { zkey: string; wasm: string; witgen: string } {
    const root = path.resolve(process.env.COORDINATOR_ZKEY_PATH!);
    const index = name.indexOf("_");
    const type = name.slice(0, index);
    const params = name.slice(index + 1);
    const mode = useQuadraticVoting ? "" : "NonQv";
    const filename = `${type}${mode}_${params}`;

    return {
      zkey: path.resolve(root, `${filename}/${filename}.0.zkey`),
      wasm: path.resolve(root, `${filename}/${filename}_js/${filename}.wasm`),
      witgen: path.resolve(root, `${filename}/${filename}_cpp/${filename}`),
    };
  }
}