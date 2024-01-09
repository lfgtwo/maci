import { BaseContract } from "ethers";
import { type MACI, type TopupCredit, getDefaultSigner, parseArtifact } from "maci-contracts";

import { banner } from "../utils/banner";
import { contractExists } from "../utils/contracts";
import { readContractAddress } from "../utils/storage";
import { logError, logGreen, success } from "../utils/theme";

/**
 * Utility that can be used to get
 * topup credits aidropped
 * to the coordinator
 * @param amount the amount of credits to airdrop
 * @param contractAddress the address of the ERC20 contract
 * @param pollId the id of the poll
 * @param maciAddress the address of the MACI contract
 * @param quiet whether to log the output
 */
export const airdrop = async (
  amount: number,
  contractAddress?: string,
  pollId?: number,
  maciAddress?: string,
  quiet = true,
): Promise<void> => {
  banner(quiet);

  // get the topup credit address from storage
  const topupCredit = readContractAddress("TopupCredit");

  // we want to ensure that we have either the address stored
  // or that it was passed as a paramter
  if (!topupCredit && !contractAddress) {
    logError("Please provide an ERC20 contract address");
  }

  const ERC20Address = contractAddress || topupCredit;

  // get the signer
  const signer = await getDefaultSigner();
  // check if the contract exists
  if (!(await contractExists(signer.provider!, ERC20Address))) {
    logError("Invalid ERC20 contract address");
  }

  const tokenAbi = parseArtifact("TopupCredit")[0];

  // create the contract instance
  const tokenContract = new BaseContract(ERC20Address, tokenAbi, signer) as TopupCredit;

  if (amount < 0) {
    logError("Invalid amount");
  }

  // try to get the tokens airdropped
  try {
    const tx = await tokenContract.airdrop(amount.toString(), {
      gasLimit: 1000000,
    });
    await tx.wait();

    logGreen(quiet, success(`Airdropped ${amount} credits to ${await signer.getAddress()}`));
  } catch (error) {
    logError((error as Error).message);
  }

  // if there is a poll id provided, we can pre-approve all of the tokens
  // so there is no need to do it afterwards
  if (pollId !== undefined) {
    const maciContractAddress = readContractAddress("MACI") ? readContractAddress("MACI") : maciAddress;

    if (!maciAddress) {
      logError("Please provide a MACI contract address");
    }

    const maciAbi = parseArtifact("MACI")[0];
    const maciContract = new BaseContract(maciContractAddress!, maciAbi, signer) as MACI;

    const pollAddr = await maciContract.getPoll(pollId);
    try {
      const tx = await tokenContract.approve(pollAddr, amount, { gasLimit: 1000000 });
      await tx.wait();

      logGreen(quiet, success(`Approved ${pollAddr} to spend ${amount} credits`));
    } catch (error) {
      logError((error as Error).message);
    }
  }
};
