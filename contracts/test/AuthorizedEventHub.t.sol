// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {AEHAppBase} from "../src/AEHAppBase.sol";
import {AuthorizedEventHub} from "../src/AuthorizedEventHub.sol";
import {CheckpointedAEHAppBase} from "../src/CheckpointedAEHAppBase.sol";
import {IAuthorizedEventHub} from "../src/IAuthorizedEventHub.sol";
import {PaymentDemoApp} from "../src/PaymentDemoApp.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter)
        external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function addr(uint256 privateKey) external returns (address wallet);
}

contract MiniTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        require(value, "assertTrue failed");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "assertFalse failed");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address mismatch");
    }

    function assertEq(bytes32 actual, bytes32 expected) internal pure {
        require(actual == expected, "bytes32 mismatch");
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint256 mismatch");
    }

    function assertEq(string memory actual, string memory expected) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), "string mismatch");
    }
}

contract CrossDomainHook is AEHAppBase {
    string private crossDomainPath;

    constructor(IAuthorizedEventHub aeh_, string memory crossDomainPath_) AEHAppBase(aeh_) {
        crossDomainPath = crossDomainPath_;
    }

    function onAction(address, bytes32, bytes calldata) external onlyAEH {
        aeh.publish(crossDomainPath, "CrossDomain", "", keccak256("cross-domain"), "");
    }
}

contract AuthorizedEventHubTest is MiniTest {
    bytes32 private constant FORWARD_REQUEST_TYPEHASH = keccak256(
        "ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)"
    );
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PAYMENT_APP_ID = keccak256("payment-demo-app");

    uint256 private constant RELAY_OWNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant RELAY_USER_PRIVATE_KEY = 0xB0B;
    address private constant ADMIN = address(0xAD);
    address private constant OWNER = address(0x1234);
    address private constant WRITER = address(0xBEEF);
    address private constant STRANGER = address(0xCAFE);
    address private constant RECIPIENT = address(0xF00D);
    address private constant RELAYER = address(0x1A1A);
    string private constant PATH = "/0x0000000000000000000000000000000000001234/apps/demo";
    bytes32 private constant CONTENT_HASH = keccak256("content-v1");
    bytes32 private constant UPDATED_CONTENT_HASH = keccak256("content-v2");

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

    ERC2771Forwarder private forwarder;
    AuthorizedEventHub private hub;
    PaymentDemoApp private payment;
    address private relayOwner;
    address private relayUser;

    function setUp() public {
        relayOwner = vm.addr(RELAY_OWNER_PRIVATE_KEY);
        relayUser = vm.addr(RELAY_USER_PRIVATE_KEY);
        forwarder = new ERC2771Forwarder("Storail Forwarder");
        hub = new AuthorizedEventHub(address(forwarder), ADMIN);
        payment = new PaymentDemoApp(hub, ADMIN, 1_000_000);

        string memory paymentDomainPrefix = payment.domainPrefix();
        vm.prank(ADMIN);
        hub.configureApp(PAYMENT_APP_ID, address(payment), paymentDomainPrefix, true);
    }

    function testOwnerPublishesUpdatesAndRemovesEvents() public {
        vm.expectEmit(true, true, true, true, address(hub));
        emit Published(
            hub.hashPath(PATH), OWNER, OWNER, PATH, "synthetic", "synthetic-v1", CONTENT_HASH, "{\"name\":\"demo\"}"
        );
        vm.prank(OWNER);
        hub.publish(PATH, "synthetic", "synthetic-v1", CONTENT_HASH, "{\"name\":\"demo\"}");

        vm.expectEmit(true, true, true, true, address(hub));
        emit Updated(
            hub.hashPath(PATH),
            OWNER,
            OWNER,
            PATH,
            "synthetic",
            "synthetic-v2",
            UPDATED_CONTENT_HASH,
            "{\"name\":\"demo-v2\"}"
        );
        vm.prank(OWNER);
        hub.update(PATH, "synthetic", "synthetic-v2", UPDATED_CONTENT_HASH, "{\"name\":\"demo-v2\"}");

        vm.expectEmit(true, true, true, true, address(hub));
        emit Deleted(hub.hashPath(PATH), OWNER, OWNER, PATH);
        vm.prank(OWNER);
        hub.remove(PATH);
    }

    function testDomainWriterPermissionRemainsL1Enforced() public {
        string memory domain = _pathFor(OWNER, "/apps/demo");
        string memory childPath = _pathFor(OWNER, "/apps/demo/item");
        string memory siblingPath = _pathFor(OWNER, "/apps/demo2/item");

        vm.prank(OWNER);
        hub.grantWriter(domain, WRITER);

        assertTrue(hub.isWriter(OWNER, domain, WRITER));

        vm.prank(WRITER);
        hub.publish(childPath, "synthetic", "synthetic-v1", CONTENT_HASH, "{}");

        vm.prank(WRITER);
        hub.update(childPath, "synthetic", "synthetic-v2", UPDATED_CONTENT_HASH, "{}");

        vm.prank(WRITER);
        hub.remove(childPath);

        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.Unauthorized.selector, WRITER, OWNER));
        hub.publish(siblingPath, "synthetic", "synthetic-sibling", CONTENT_HASH, "{}");

        vm.prank(OWNER);
        hub.revokeWriter(domain, WRITER);

        assertFalse(hub.isWriter(OWNER, domain, WRITER));

        vm.prank(WRITER);
        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.Unauthorized.selector, WRITER, OWNER));
        hub.update(childPath, "synthetic", "synthetic-v3", UPDATED_CONTENT_HASH, "{}");
    }

    function testOwnerKeepsAuthorityOverGrantedSubdomain() public {
        string memory domain = _pathFor(OWNER, "/apps/demo");
        string memory childPath = _pathFor(OWNER, "/apps/demo/item");

        vm.prank(OWNER);
        hub.grantWriter(domain, WRITER);

        vm.prank(OWNER);
        hub.publish(childPath, "synthetic", "synthetic-owner-after-writer-remove", CONTENT_HASH, "{}");
    }

    function testUnauthorizedPublishReverts() public {
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.Unauthorized.selector, STRANGER, OWNER));
        hub.publish(PATH, "synthetic", "synthetic-v1", CONTENT_HASH, "{}");
    }

    function testRelayedPublicDomainPublish() public {
        string memory path = _pathFor(relayOwner, "/apps/demo");
        vm.expectEmit(true, true, true, true, address(hub));
        emit Published(hub.hashPath(path), relayOwner, relayOwner, path, "synthetic", "synthetic-v1", CONTENT_HASH, "{}");
        _relay(
            RELAY_OWNER_PRIVATE_KEY,
            relayOwner,
            address(hub),
            abi.encodeWithSelector(hub.publish.selector, path, "synthetic", "synthetic-v1", CONTENT_HASH, "{}")
        );
    }

    function testPaymentConstructorPublishesInitSupplyInstruction() public view {
        assertEq(payment.instructionCount(), 1);
        assertEq(payment.eventCount(), 1);
    }

    function testPaymentDuplicateInitSupplyInstructionRemainsAuditable() public {
        string memory path = payment.inboxPath();
        string memory metadata = string.concat(Strings.toHexString(STRANGER), ":2000000");

        vm.expectEmit(true, true, true, true, address(hub));
        emit Updated(
            hub.hashPath(path),
            address(payment),
            address(payment),
            path,
            "InitSupply",
            Strings.toHexString(ADMIN),
            keccak256(abi.encode(payment.INSTRUCTION_INIT_SUPPLY(), STRANGER, ADMIN, 2_000_000)),
            metadata
        );
        vm.prank(STRANGER);
        payment.initializeSupply(2_000_000);

        assertEq(payment.instructionCount(), 2);
    }

    function testPaymentZeroAddressTransferInstructionRemainsAuditable() public {
        string memory path = payment.inboxPath();
        string memory metadata = string.concat(Strings.toHexString(STRANGER), ":1");

        vm.expectEmit(true, true, true, true, address(hub));
        emit Updated(
            hub.hashPath(path),
            address(payment),
            address(payment),
            path,
            "Transfer",
            Strings.toHexString(address(0)),
            keccak256(abi.encode(payment.INSTRUCTION_TRANSFER(), STRANGER, address(0), 1)),
            metadata
        );
        vm.prank(STRANGER);
        payment.transfer(address(0), 1);
    }

    function testPaymentDirectTransferAppendsInstructionWithoutCheckingBalance() public {
        string memory path = payment.inboxPath();
        string memory metadata = string.concat(Strings.toHexString(STRANGER), ":", Strings.toString(type(uint256).max));

        vm.expectEmit(true, true, true, true, address(hub));
        emit Updated(
            hub.hashPath(path),
            address(payment),
            address(payment),
            path,
            "Transfer",
            Strings.toHexString(RECIPIENT),
            keccak256(abi.encode(payment.INSTRUCTION_TRANSFER(), STRANGER, RECIPIENT, type(uint256).max)),
            metadata
        );
        vm.prank(STRANGER);
        payment.transfer(RECIPIENT, type(uint256).max);

        assertEq(payment.instructionCount(), 2);
        assertEq(payment.eventCount(), 2);
    }

    function testRelayedRegisteredPaymentTransferPreservesUserActor() public {
        string memory path = payment.inboxPath();
        bytes32 instructionHash = keccak256(abi.encode(payment.INSTRUCTION_TRANSFER(), relayUser, RECIPIENT, 25));
        string memory metadata = string.concat(Strings.toHexString(relayUser), ":25");

        vm.expectEmit(true, true, true, true, address(hub));
        emit Updated(
            hub.hashPath(path),
            address(payment),
            relayUser,
            path,
            "Transfer",
            Strings.toHexString(RECIPIENT),
            instructionHash,
            metadata
        );

        _relay(
            RELAY_USER_PRIVATE_KEY,
            relayUser,
            address(hub),
            abi.encodeWithSelector(
                hub.submitToApp.selector, PAYMENT_APP_ID, payment.ACTION_TRANSFER(), abi.encode(RECIPIENT, 25)
            )
        );
    }

    function testPaymentHookRejectsDirectCalls() public {
        bytes32 actionTransfer = payment.ACTION_TRANSFER();
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(AEHAppBase.OnlyAEH.selector));
        payment.onAction(STRANGER, actionTransfer, abi.encode(RECIPIENT, 1));
    }

    function testRegisteredHookCannotWriteOutsideConfiguredDomain() public {
        CrossDomainHook hook = new CrossDomainHook(hub, _pathFor(address(0x9999), "/outside"));
        bytes32 appId = keccak256("cross-domain");

        vm.prank(ADMIN);
        hub.configureApp(appId, address(hook), _pathFor(address(hook), "/allowed/"), true);

        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.HookDomainViolation.selector));
        hub.submitToApp(appId, bytes32(0), "");
    }

    function testRegisteredHookPrefixMustBelongToHook() public {
        CrossDomainHook hook = new CrossDomainHook(hub, _pathFor(address(0x9999), "/outside"));

        vm.prank(ADMIN);
        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.HookDomainViolation.selector));
        hub.configureApp(keccak256("wrong-owner"), address(hook), _pathFor(address(0x9999), "/allowed/"), true);
    }

    function testRegisteredHookPrefixUsesPathBoundary() public {
        CrossDomainHook hook = new CrossDomainHook(hub, _pathFor(address(0x9999), "/outside"));

        vm.prank(ADMIN);
        hub.configureApp(keccak256("missing-boundary"), address(hook), _pathFor(address(hook), "/allowed"), true);

        vm.expectRevert(abi.encodeWithSelector(AuthorizedEventHub.HookDomainViolation.selector));
        hub.submitToApp(keccak256("missing-boundary"), bytes32(0), "");
    }

    function testPaymentHashChainMatchesInstructionOrder() public {
        bytes32 initHash = keccak256(abi.encode(payment.INSTRUCTION_INIT_SUPPLY(), ADMIN, ADMIN, 1_000_000));
        bytes32 transferHash = keccak256(abi.encode(payment.INSTRUCTION_TRANSFER(), STRANGER, RECIPIENT, 50));

        vm.prank(STRANGER);
        payment.transfer(RECIPIENT, 50);

        assertEq(
            payment.currentEventHash(),
            keccak256(abi.encodePacked(keccak256(abi.encodePacked(bytes32(0), initHash)), transferHash))
        );
    }

    function testPaymentCheckpointCreatedAtBoundary() public {
        for (uint256 i = 1; i < payment.CHECKPOINT_INTERVAL(); i++) {
            vm.prank(STRANGER);
            payment.transfer(address(uint160(100_000 + i)), i);
        }

        assertEq(payment.eventCount(), payment.CHECKPOINT_INTERVAL());
        assertEq(payment.checkpointCount(), 1);

        CheckpointedAEHAppBase.EventHashCheckpoint memory checkpoint = payment.getCheckpoint(1);
        assertEq(checkpoint.eventCount, payment.CHECKPOINT_INTERVAL());
        assertEq(checkpoint.eventHash, payment.currentEventHash());
        assertTrue(checkpoint.timestamp > 0);
    }

    function _relay(uint256 signerPrivateKey, address signer, address target, bytes memory data) private {
        uint48 deadline = uint48(block.timestamp + 1 hours);
        bytes memory signature = _signForwardRequest(signerPrivateKey, signer, target, 0, 1_500_000, deadline, data);

        ERC2771Forwarder.ForwardRequestData memory request = ERC2771Forwarder.ForwardRequestData({
            from: signer,
            to: target,
            value: 0,
            gas: 1_500_000,
            deadline: deadline,
            data: data,
            signature: signature
        });

        vm.prank(RELAYER);
        forwarder.execute(request);
    }

    function _signForwardRequest(
        uint256 signerPrivateKey,
        address signer,
        address target,
        uint256 value,
        uint256 gasLimit,
        uint48 deadline,
        bytes memory data
    ) private returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Storail Forwarder")),
                keccak256(bytes("1")),
                block.chainid,
                address(forwarder)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                FORWARD_REQUEST_TYPEHASH,
                signer,
                target,
                value,
                gasLimit,
                forwarder.nonces(signer),
                deadline,
                keccak256(data)
            )
        );
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pathFor(address owner, string memory suffix) private pure returns (string memory) {
        return string.concat("/", Strings.toHexString(owner), suffix);
    }
}
