// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Defa Wang
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CheckpointedAEHAppBase} from "./CheckpointedAEHAppBase.sol";
import {IAuthorizedEventHub} from "./IAuthorizedEventHub.sol";

contract PaymentDemoApp is CheckpointedAEHAppBase {
    bytes32 public constant ACTION_INIT_SUPPLY = keccak256("InitSupply");
    bytes32 public constant ACTION_TRANSFER = keccak256("Transfer");
    bytes32 public constant INSTRUCTION_INIT_SUPPLY = keccak256("InitSupply");
    bytes32 public constant INSTRUCTION_TRANSFER = keccak256("Transfer");
    string public constant APP_NAME = "payment-demo-app";

    address public immutable developer;
    uint256 public immutable initialSupply;
    uint256 public instructionCount;

    error InvalidRecipient();
    error UnsupportedAction();

    constructor(
        IAuthorizedEventHub aeh_,
        address developer_,
        uint256 initialSupply_
    ) CheckpointedAEHAppBase(aeh_) {
        if (developer_ == address(0)) {
            revert InvalidRecipient();
        }

        developer = developer_;
        initialSupply = initialSupply_;
        _appendInitSupply(developer_, developer_, initialSupply_);
    }

    function initializeSupply(uint256 amount) external {
        _appendInitSupply(msg.sender, developer, amount);
    }

    function transfer(address to, uint256 amount) external {
        _appendTransfer(msg.sender, to, amount);
    }

    function inboxPath() public view returns (string memory) {
        return
            string.concat(
                "/",
                Strings.toHexString(address(this)),
                "/",
                APP_NAME,
                "/inbox"
            );
    }

    function domainPrefix() public view returns (string memory) {
        return
            string.concat(
                "/",
                Strings.toHexString(address(this)),
                "/",
                APP_NAME,
                "/"
            );
    }

    function onAction(
        address actor,
        bytes32 actionType,
        bytes calldata payload
    ) external onlyAEH {
        if (actionType == ACTION_INIT_SUPPLY) {
            _appendInitSupply(actor, developer, abi.decode(payload, (uint256)));
            return;
        }
        if (actionType == ACTION_TRANSFER) {
            (address to, uint256 amount) = abi.decode(
                payload,
                (address, uint256)
            );
            _appendTransfer(actor, to, amount);
            return;
        }
        revert UnsupportedAction();
    }

    function _appendInitSupply(
        address actor,
        address recipient,
        uint256 amount
    ) private {
        uint256 sequence = ++instructionCount;
        bytes32 instructionHash = keccak256(
            abi.encode(INSTRUCTION_INIT_SUPPLY, actor, recipient, amount)
        );
        _publishInstruction(
            sequence == 1,
            APP_NAME,
            "InitSupply",
            Strings.toHexString(recipient),
            instructionHash,
            string.concat(
                Strings.toHexString(actor),
                ":",
                Strings.toString(amount)
            )
        );
    }

    function _appendTransfer(address from, address to, uint256 amount) private {
        uint256 sequence = ++instructionCount;
        bytes32 instructionHash = keccak256(
            abi.encode(INSTRUCTION_TRANSFER, from, to, amount)
        );
        _publishInstruction(
            sequence == 1,
            APP_NAME,
            "Transfer",
            Strings.toHexString(to),
            instructionHash,
            string.concat(
                Strings.toHexString(from),
                ":",
                Strings.toString(amount)
            )
        );
    }
}
