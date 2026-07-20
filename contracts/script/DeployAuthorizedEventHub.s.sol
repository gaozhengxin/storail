// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Defa Wang
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";
import {AuthorizedEventHub} from "../src/AuthorizedEventHub.sol";
import {PaymentDemoApp} from "../src/PaymentDemoApp.sol";

interface Vm {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address wallet);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployAuthorizedEventHub {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ERC2771Forwarder forwarder, AuthorizedEventHub hub, PaymentDemoApp paymentDemo) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);

        vm.startBroadcast(privateKey);
        forwarder = new ERC2771Forwarder("Storail Forwarder");
        hub = new AuthorizedEventHub(address(forwarder), deployer);
        paymentDemo = new PaymentDemoApp(hub, deployer, 1_000_000 ether);
        hub.configureApp(keccak256("payment-demo-app"), address(paymentDemo), paymentDemo.domainPrefix(), true);
        vm.stopBroadcast();
    }
}
