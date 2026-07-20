// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Defa Wang
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IAuthorizedEventHub} from "./IAuthorizedEventHub.sol";
import {IAEHHook} from "./IAEHHook.sol";

abstract contract AEHAppBase is IAEHHook {
    IAuthorizedEventHub public immutable aeh;

    error OnlyAEH();

    constructor(IAuthorizedEventHub aeh_) {
        aeh = aeh_;
    }

    modifier onlyAEH() {
        if (msg.sender != address(aeh)) {
            revert OnlyAEH();
        }
        _;
    }

    function _publishInstruction(
        bool initializeInbox,
        string memory appName,
        string memory instructionType,
        string memory pointer,
        bytes32 instructionHash,
        string memory metadata
    ) internal virtual {
        string memory inboxPath = string.concat("/", Strings.toHexString(address(this)), "/", appName, "/inbox");
        if (initializeInbox) {
            aeh.publish(inboxPath, instructionType, pointer, instructionHash, metadata);
        } else {
            aeh.update(inboxPath, instructionType, pointer, instructionHash, metadata);
        }
    }
}
