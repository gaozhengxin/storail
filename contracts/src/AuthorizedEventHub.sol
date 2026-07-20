// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Defa Wang
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {IAEHHook} from "./IAEHHook.sol";
import {IAuthorizedEventHub} from "./IAuthorizedEventHub.sol";

contract AuthorizedEventHub is IAuthorizedEventHub, Ownable, ERC2771Context {
    struct RegisteredApp {
        address hook;
        string domainPrefix;
        bool enabled;
    }

    error InvalidApp();
    error InvalidPath();
    error InvalidWriter();
    error HookDispatchActive();
    error HookDomainViolation();
    error Unauthorized(address actor, address owner);

    event Published(
        bytes32 indexed pathHash,
        address indexed owner,
        address indexed actor,
        string path,
        string providerId,
        string pointer,
        bytes32 contentHash,
        string metadata
    );
    event Updated(
        bytes32 indexed pathHash,
        address indexed owner,
        address indexed actor,
        string path,
        string providerId,
        string pointer,
        bytes32 contentHash,
        string metadata
    );
    event Deleted(bytes32 indexed pathHash, address indexed owner, address indexed actor, string path);
    event WriterGranted(address indexed owner, bytes32 indexed domainHash, address indexed writer, string domain);
    event WriterRevoked(address indexed owner, bytes32 indexed domainHash, address indexed writer, string domain);
    event AppConfigured(bytes32 indexed appId, address indexed hook, string domainPrefix, bool enabled);

    mapping(address owner => mapping(bytes32 domainHash => mapping(address writer => bool allowed))) private
        writerPermissions;
    mapping(bytes32 appId => RegisteredApp app) private registeredApps;
    address private activeHook;
    address private activeActionActor;
    string private activeDomainPrefix;

    constructor(address trustedForwarder, address initialOwner)
        Ownable(initialOwner)
        ERC2771Context(trustedForwarder)
    {}

    function publish(
        string calldata path,
        string calldata providerId,
        string calldata pointer,
        bytes32 contentHash,
        string calldata metadata
    ) external override {
        address caller = _msgSender();
        address owner = _requireCanWritePath(path, caller);
        bytes32 pathHash = hashPath(path);

        emit Published(pathHash, owner, _mutationActor(caller), path, providerId, pointer, contentHash, metadata);
    }

    function update(
        string calldata path,
        string calldata providerId,
        string calldata pointer,
        bytes32 contentHash,
        string calldata metadata
    ) external override {
        address caller = _msgSender();
        address owner = _requireCanWritePath(path, caller);
        bytes32 pathHash = hashPath(path);

        emit Updated(pathHash, owner, _mutationActor(caller), path, providerId, pointer, contentHash, metadata);
    }

    function remove(string calldata path) external {
        address caller = _msgSender();
        address owner = _requireCanWritePath(path, caller);
        bytes32 pathHash = hashPath(path);

        emit Deleted(pathHash, owner, _mutationActor(caller), path);
    }

    function grantWriter(string calldata domain, address writer) external {
        address actor = _msgSender();
        address owner = namespaceOwner(domain);
        if (writer == address(0) || writer == actor) {
            revert InvalidWriter();
        }
        if (actor != owner) {
            revert Unauthorized(actor, owner);
        }

        bytes32 domainHash = hashPath(domain);
        writerPermissions[owner][domainHash][writer] = true;
        emit WriterGranted(owner, domainHash, writer, domain);
    }

    function revokeWriter(string calldata domain, address writer) external {
        address actor = _msgSender();
        address owner = namespaceOwner(domain);
        if (writer == address(0) || writer == actor) {
            revert InvalidWriter();
        }
        if (actor != owner) {
            revert Unauthorized(actor, owner);
        }

        bytes32 domainHash = hashPath(domain);
        writerPermissions[owner][domainHash][writer] = false;
        emit WriterRevoked(owner, domainHash, writer, domain);
    }

    function configureApp(bytes32 appId, address hook, string calldata domainPrefix, bool enabled) external onlyOwner {
        if (appId == bytes32(0) || hook == address(0)) {
            revert InvalidApp();
        }
        if (namespaceOwner(domainPrefix) != hook) {
            revert HookDomainViolation();
        }

        registeredApps[appId] = RegisteredApp({hook: hook, domainPrefix: domainPrefix, enabled: enabled});
        emit AppConfigured(appId, hook, domainPrefix, enabled);
    }

    function submitToApp(bytes32 appId, bytes32 actionType, bytes calldata payload) external {
        RegisteredApp memory app = registeredApps[appId];
        if (!app.enabled || app.hook == address(0)) {
            revert InvalidApp();
        }
        if (activeHook != address(0)) {
            revert HookDispatchActive();
        }

        address actor = _msgSender();
        activeHook = app.hook;
        activeActionActor = actor;
        activeDomainPrefix = app.domainPrefix;
        IAEHHook(app.hook).onAction(actor, actionType, payload);
        delete activeHook;
        delete activeActionActor;
        delete activeDomainPrefix;
    }

    function getApp(bytes32 appId) external view returns (RegisteredApp memory) {
        return registeredApps[appId];
    }

    function isWriter(address owner, string calldata domain, address writer) external view returns (bool) {
        return writerPermissions[owner][hashPath(domain)][writer];
    }

    function hashPath(string calldata path) public pure returns (bytes32) {
        return keccak256(bytes(path));
    }

    function namespaceOwner(string calldata path) public pure returns (address) {
        bytes calldata pathBytes = bytes(path);
        if (pathBytes.length < 43 || pathBytes[0] != "/" || pathBytes[1] != "0" || !_isX(pathBytes[2])) {
            revert InvalidPath();
        }
        if (pathBytes.length > 43 && pathBytes[43] != "/") {
            revert InvalidPath();
        }

        uint160 parsed;
        for (uint256 i = 3; i < 43; i++) {
            parsed = (parsed << 4) | uint160(_hexValue(pathBytes[i]));
        }

        return address(parsed);
    }

    function _requireCanWritePath(string calldata path, address actor) private view returns (address) {
        address owner = namespaceOwner(path);
        _requireActiveHookPath(actor, path);
        if (actor != owner && !_hasWriterPermission(owner, path, actor)) {
            revert Unauthorized(actor, owner);
        }
        return owner;
    }

    function _hasWriterPermission(address owner, string calldata path, address writer) private view returns (bool) {
        bytes calldata pathBytes = bytes(path);

        for (uint256 i = 43; i < pathBytes.length; i++) {
            if (pathBytes[i] == "/") {
                if (writerPermissions[owner][keccak256(pathBytes[:i])][writer]) {
                    return true;
                }
            }
        }

        return writerPermissions[owner][keccak256(pathBytes)][writer];
    }

    function _requireActiveHookPath(address actor, string calldata path) private view {
        if (actor == activeHook && !_pathWithinDomain(path, activeDomainPrefix)) {
            revert HookDomainViolation();
        }
    }

    function _mutationActor(address caller) private view returns (address) {
        return caller == activeHook ? activeActionActor : caller;
    }

    function _pathWithinDomain(string calldata path, string memory domain) private pure returns (bool) {
        bytes calldata pathBytes = bytes(path);
        bytes memory domainBytes = bytes(domain);
        if (pathBytes.length < domainBytes.length) {
            return false;
        }

        for (uint256 i = 0; i < domainBytes.length; i++) {
            if (pathBytes[i] != domainBytes[i]) {
                return false;
            }
        }

        if (pathBytes.length == domainBytes.length) {
            return true;
        }
        if (domainBytes[domainBytes.length - 1] == "/") {
            return true;
        }
        return pathBytes[domainBytes.length] == "/";
    }

    function _isX(bytes1 value) private pure returns (bool) {
        return value == "x" || value == "X";
    }

    function _hexValue(bytes1 char) private pure returns (uint8) {
        uint8 value = uint8(char);
        if (value >= uint8(bytes1("0")) && value <= uint8(bytes1("9"))) {
            return value - uint8(bytes1("0"));
        }
        if (value >= uint8(bytes1("a")) && value <= uint8(bytes1("f"))) {
            return 10 + value - uint8(bytes1("a"));
        }
        if (value >= uint8(bytes1("A")) && value <= uint8(bytes1("F"))) {
            return 10 + value - uint8(bytes1("A"));
        }
        revert InvalidPath();
    }

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
