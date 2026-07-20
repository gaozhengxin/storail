// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Defa Wang
pragma solidity ^0.8.24;

import {AEHAppBase} from "./AEHAppBase.sol";
import {IAuthorizedEventHub} from "./IAuthorizedEventHub.sol";

abstract contract CheckpointedAEHAppBase is AEHAppBase {
    struct EventHashCheckpoint {
        uint256 eventCount;
        bytes32 eventHash;
        uint256 timestamp;
    }

    uint256 public constant CHECKPOINT_INTERVAL = 1000;

    bytes32 public currentEventHash;
    uint256 public eventCount;

    mapping(uint256 checkpointIndex => EventHashCheckpoint checkpoint) private checkpoints;

    constructor(IAuthorizedEventHub aeh_) AEHAppBase(aeh_) {}

    function getCheckpoint(uint256 checkpointIndex) external view returns (EventHashCheckpoint memory) {
        return checkpoints[checkpointIndex];
    }

    function checkpointCount() external view returns (uint256) {
        return eventCount / CHECKPOINT_INTERVAL;
    }

    function _publishInstruction(
        bool initializeInbox,
        string memory appName,
        string memory instructionType,
        string memory pointer,
        bytes32 instructionHash,
        string memory metadata
    ) internal virtual override {
        super._publishInstruction(initializeInbox, appName, instructionType, pointer, instructionHash, metadata);
        _commitEvent(instructionHash);
    }

    function _commitEvent(bytes32 eventHash) private {
        bytes32 newEventHash = keccak256(abi.encodePacked(currentEventHash, eventHash));
        uint256 newEventCount = eventCount + 1;

        currentEventHash = newEventHash;
        eventCount = newEventCount;

        if (newEventCount % CHECKPOINT_INTERVAL == 0) {
            uint256 checkpointIndex = newEventCount / CHECKPOINT_INTERVAL;
            checkpoints[checkpointIndex] =
                EventHashCheckpoint({eventCount: newEventCount, eventHash: newEventHash, timestamp: block.timestamp});
        }
    }
}
