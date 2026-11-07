// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HelpToken, ProoflyBadge, ProoflyForum} from "../contracts/Proofly.sol";

interface Vm {
    function expectRevert() external;
    function expectRevert(bytes calldata) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function deal(address who, uint256 newBalance) external;
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

abstract contract ProoflyTestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 actual, uint256 expected, string memory message) internal pure {
        require(actual == expected, message);
    }

    function assertEq(address actual, address expected, string memory message) internal pure {
        require(actual == expected, message);
    }

    function assertEq(string memory actual, string memory expected, string memory message) internal pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), message);
    }

    function assertTrue(bool condition, string memory message) internal pure {
        require(condition, message);
    }
}

contract HelpTokenTest is ProoflyTestBase {
    HelpToken internal help;
    address internal learner = address(0xA11CE);

    function setUp() public {
        help = new HelpToken();
    }

    function testInitialSupplyAndOwner() public view {
        assertEq(help.totalSupply(), 1_000_000 ether, "wrong initial supply");
        assertEq(help.balanceOf(address(this)), 1_000_000 ether, "deployer did not receive supply");
        assertEq(help.owner(), address(this), "wrong initial owner");
    }

    function testOnlyOwnerCanRewardLearner() public {
        help.reward(learner, 7 ether);
        assertEq(help.balanceOf(learner), 7 ether, "reward not minted");

        vm.prank(learner);
        vm.expectRevert();
        help.reward(learner, 1 ether);
    }

    function testStudentCanBuyPermanentHelpWithEth() public {
        vm.deal(learner, 1 ether);
        vm.prank(learner);
        uint256 purchased = help.buyHelp{value: 0.2 ether}();
        assertEq(purchased, 20 ether, "wrong purchase amount");
        assertEq(help.balanceOf(learner), 20 ether, "purchased HELP missing");
        (uint256 expiring,) = help.expiringBalanceOf(learner);
        assertEq(expiring, 0, "purchased HELP must not expire");
    }

    function testAnswerRewardExpiresAfterNinetyDays() public {
        help.rewardAnswer(learner, 1 ether);
        (uint256 expiring, uint256 expiresAt) = help.expiringBalanceOf(learner);
        assertEq(expiring, 1 ether, "answer reward not tracked");
        assertEq(expiresAt, block.timestamp + 90 days, "wrong expiry");
        vm.warp(block.timestamp + 90 days);
        help.purgeExpired(learner);
        assertEq(help.balanceOf(learner), 0, "expired reward not burned");
    }

    function testTransferCannotResetAnswerRewardExpiry() public {
        address recipient = address(0xCAFE);
        help.rewardAnswer(learner, 1 ether);
        vm.prank(learner);
        help.transfer(recipient, 1 ether);
        (uint256 expiring, uint256 expiresAt) = help.expiringBalanceOf(recipient);
        assertEq(expiring, 1 ether, "expiry did not follow transfer");
        vm.warp(expiresAt);
        help.purgeExpired(recipient);
        assertEq(help.balanceOf(recipient), 0, "transferred reward avoided expiry");
    }
}

contract ProoflyBadgeTest is ProoflyTestBase {
    ProoflyBadge internal badge;
    address internal learner = address(0xB0B);
    uint256 internal issuerKey = 0xA11CE;
    address internal issuer;

    function setUp() public {
        issuer = vm.addr(issuerKey);
        badge = new ProoflyBadge(issuer);
    }

    function authorization(address recipient, string memory badgeId, string memory metadataURI, uint256 nonce, uint256 deadline) internal returns (bytes memory) {
        bytes32 digest = badge.claimDigest(recipient, badgeId, metadataURI, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function testMintsSixDistinctBadgeTypesToOneAddress() public {
        string[6] memory ids = [
            "learning-pioneer",
            "best-explainer",
            "curious-mind",
            "consensus-guide",
            "security-scout",
            "course-finisher"
        ];

        vm.startPrank(learner);
        for (uint256 i; i < ids.length; ++i) {
            string memory uri = string.concat("https://proofly.local/metadata/", ids[i], ".json");
            uint256 deadline = block.timestamp + 1 hours;
            bytes memory signature = authorization(learner, ids[i], uri, i + 1, deadline);
            uint256 tokenId = badge.mintBadge(ids[i], uri, i + 1, deadline, signature);
            assertEq(tokenId, i + 1, "unexpected token id");
            assertEq(badge.ownerOf(tokenId), learner, "wrong badge owner");
            assertTrue(badge.badgeTypeMinted(learner, keccak256(bytes(ids[i]))), "badge type not recorded");
        }
        vm.stopPrank();

        assertEq(badge.balanceOf(learner), 6, "wrong badge balance");
        assertEq(badge.nextTokenId(), 7, "wrong next token id");
    }

    function testLegacyLearningPioneerMintUsesSameIdentity() public {
        string memory uri = "https://proofly.local/metadata/learning-pioneer.json";
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = authorization(learner, "learning-pioneer", uri, 1, deadline);
        vm.prank(learner);
        badge.mintLearningBadge(uri, 1, deadline, signature);
        assertTrue(badge.badgeMinted(learner), "legacy flag not set");

        signature = authorization(learner, "learning-pioneer", "different-uri", 2, deadline);
        vm.prank(learner);
        vm.expectRevert(bytes("Badge already minted for this address"));
        badge.mintBadge("learning-pioneer", "different-uri", 2, deadline, signature);
    }

    function testCannotMintDuplicateBadgeTypeOrEmptyId() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory firstSignature = authorization(learner, "best-explainer", "uri-one", 1, deadline);
        vm.startPrank(learner);
        badge.mintBadge("best-explainer", "uri-one", 1, deadline, firstSignature);
        bytes memory secondSignature = authorization(learner, "best-explainer", "uri-two", 2, deadline);
        vm.expectRevert(bytes("Badge already minted for this address"));
        badge.mintBadge("best-explainer", "uri-two", 2, deadline, secondSignature);
        vm.expectRevert(bytes("Badge ID required"));
        badge.mintBadge("", "uri-three", 3, deadline, "");
        vm.stopPrank();
    }

    function testRejectsInvalidModifiedExpiredAndReplayedClaims() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory signature = authorization(learner, "consensus-guide", "correct-uri", 44, deadline);

        vm.prank(learner);
        vm.expectRevert(bytes("Invalid badge authorization"));
        badge.mintBadge("security-scout", "correct-uri", 44, deadline, signature);

        vm.prank(learner);
        badge.mintBadge("consensus-guide", "correct-uri", 44, deadline, signature);

        vm.prank(learner);
        vm.expectRevert(bytes("Claim already used"));
        badge.mintBadge("course-finisher", "correct-uri", 44, deadline, signature);

        bytes memory expiredSignature = authorization(learner, "security-scout", "uri", 45, deadline);
        vm.warp(deadline + 1);
        vm.prank(learner);
        vm.expectRevert(bytes("Claim expired"));
        badge.mintBadge("security-scout", "uri", 45, deadline, expiredSignature);
    }

    function testOwnerCanRotateIssuer() public {
        address nextIssuer = address(0xCAFE);
        badge.setIssuer(nextIssuer);
        assertEq(badge.issuer(), nextIssuer, "issuer not updated");

        vm.prank(learner);
        vm.expectRevert();
        badge.setIssuer(learner);
    }
}

contract ProoflyForumTest is ProoflyTestBase {
    HelpToken internal help;
    ProoflyForum internal forum;
    address internal asker = address(0xA5CE2);
    address internal firstAnswerer = address(0xA11CE);
    address internal secondAnswerer = address(0xB0B);
    uint256 internal issuerKey = 0xD00D;
    uint256 internal claimNonce;
    bytes32 internal askerStudent = keccak256("asker-student");
    bytes32 internal firstStudent = keccak256("first-student");
    bytes32 internal secondStudent = keccak256("second-student");

    function setUp() public {
        help = new HelpToken();
        forum = new ProoflyForum(help, vm.addr(issuerKey), 30 days);
        help.transfer(asker, 100 ether);
        help.transferOwnership(address(forum));
    }

    function claim(address wallet, bytes32 studentId, uint8 action, uint256 questionId, uint96 bounty) internal returns (uint256 nonce, uint256 deadline, bytes memory signature) {
        nonce = ++claimNonce;
        deadline = block.timestamp + 1 hours;
        bytes32 digest = forum.accountActionDigest(wallet, studentId, action, questionId, bounty, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function post(address wallet, bytes32 studentId, uint96 bounty) internal returns (uint256) {
        (uint256 nonce, uint256 deadline, bytes memory signature) = claim(wallet, studentId, forum.ACTION_POST(), 0, bounty);
        vm.prank(wallet);
        return forum.postQuestion(bounty, studentId, nonce, deadline, signature);
    }

    function answer(address wallet, bytes32 studentId, uint256 questionId) internal returns (uint256) {
        (uint256 nonce, uint256 deadline, bytes memory signature) = claim(wallet, studentId, forum.ACTION_ANSWER(), questionId, 0);
        vm.prank(wallet);
        return forum.submitAnswer(questionId, studentId, nonce, deadline, signature);
    }

    function testFirstThreeQuestionsAreSponsoredAndFourthUsesEscrow() public {
        vm.prank(asker);
        help.approve(address(forum), 100 ether);
        post(asker, askerStudent, 3 ether);
        post(asker, askerStudent, 5 ether);
        post(asker, askerStudent, 7 ether);
        uint256 balanceBefore = help.balanceOf(asker);
        uint256 fourth = post(asker, askerStudent, 5 ether);

        assertEq(forum.sponsoredQuestionsUsed(askerStudent), 3, "wrong sponsored count");
        assertEq(help.balanceOf(asker), balanceBefore - 5 ether, "fourth bounty not escrowed");
        assertEq(help.balanceOf(address(forum)), 5 ether, "forum escrow balance wrong");

        (,,, bool sponsored,,,,,) = forum.questions(fourth);
        assertTrue(!sponsored, "fourth question should be self-funded");
    }

    function testRejectsInvalidBountyAndOwnAnswer() public {
        (uint256 badNonce, uint256 badDeadline, bytes memory badSignature) = claim(asker, askerStudent, forum.ACTION_POST(), 0, 4 ether);
        vm.prank(asker);
        vm.expectRevert(bytes("Choose 3, 5, or 7 HELP"));
        forum.postQuestion(4 ether, askerStudent, badNonce, badDeadline, badSignature);

        uint256 questionId = post(asker, askerStudent, 3 ether);
        (uint256 ownNonce, uint256 ownDeadline, bytes memory ownSignature) = claim(asker, askerStudent, forum.ACTION_ANSWER(), questionId, 0);
        vm.prank(asker);
        vm.expectRevert(bytes("Cannot answer your own question"));
        forum.submitAnswer(questionId, askerStudent, ownNonce, ownDeadline, ownSignature);
    }

    function testAnswerRewardSelectionChangeAndSponsoredPayout() public {
        uint256 questionId = post(asker, askerStudent, 7 ether);

        uint256 firstId = answer(firstAnswerer, firstStudent, questionId);
        uint256 secondId = answer(secondAnswerer, secondStudent, questionId);
        assertEq(help.balanceOf(firstAnswerer), 1 ether, "first answer reward missing");
        assertEq(help.balanceOf(secondAnswerer), 1 ether, "second answer reward missing");

        vm.startPrank(asker);
        forum.selectBestAnswer(questionId, firstId);
        forum.selectBestAnswer(questionId, secondId);
        vm.stopPrank();

        (,,,,,,, uint256 selectedId, address selectedAnswerer) = forum.questions(questionId);
        assertEq(selectedId, secondId, "selection was not changed");
        assertEq(selectedAnswerer, secondAnswerer, "wrong selected answerer");

        vm.warp(block.timestamp + 30 days);
        forum.finalizeQuestion(questionId);
        assertEq(help.balanceOf(secondAnswerer), 8 ether, "winner payout wrong");
        assertEq(forum.bestAnswerCount(secondAnswerer), 1, "win not recorded");

        vm.expectRevert(bytes("Question already finalized"));
        forum.finalizeQuestion(questionId);
    }

    function testOneAnswerPerStudentAccountAndEditDoesNotRewardAgain() public {
        uint256 questionId = post(asker, askerStudent, 3 ether);
        answer(firstAnswerer, firstStudent, questionId);
        uint256 balanceAfterSubmit = help.balanceOf(firstAnswerer);

        (uint256 duplicateNonce, uint256 duplicateDeadline, bytes memory duplicateSignature) = claim(secondAnswerer, firstStudent, forum.ACTION_ANSWER(), questionId, 0);
        vm.prank(secondAnswerer);
        vm.expectRevert(bytes("Student account already answered"));
        forum.submitAnswer(questionId, firstStudent, duplicateNonce, duplicateDeadline, duplicateSignature);

        (uint256 editNonce, uint256 editDeadline, bytes memory editSignature) = claim(secondAnswerer, firstStudent, forum.ACTION_EDIT(), questionId, 0);
        vm.prank(secondAnswerer);
        forum.editAnswer(questionId, firstStudent, editNonce, editDeadline, editSignature);
        assertEq(help.balanceOf(firstAnswerer), balanceAfterSubmit, "editing issued another reward");
        assertEq(forum.answerIdByStudent(questionId, firstStudent), 1, "edit created another answer");
    }

    function testOnlyAskerCanSelectAndSelectionStopsAtExpiry() public {
        uint256 questionId = post(asker, askerStudent, 3 ether);
        uint256 answerId = answer(firstAnswerer, firstStudent, questionId);

        vm.prank(secondAnswerer);
        vm.expectRevert(bytes("Only the asker can choose"));
        forum.selectBestAnswer(questionId, answerId);

        vm.warp(block.timestamp + 30 days);
        vm.prank(asker);
        vm.expectRevert(bytes("Selection period ended"));
        forum.selectBestAnswer(questionId, answerId);
    }

    function testSelfFundedQuestionRefundsWhenClosedWithoutSelection() public {
        vm.prank(asker);
        help.approve(address(forum), 100 ether);
        post(asker, askerStudent, 3 ether);
        post(asker, askerStudent, 3 ether);
        post(asker, askerStudent, 3 ether);
        uint256 balanceBefore = help.balanceOf(asker);
        uint256 questionId = post(asker, askerStudent, 7 ether);

        assertEq(help.balanceOf(asker), balanceBefore - 7 ether, "bounty not escrowed");
        vm.warp(block.timestamp + 30 days);
        forum.finalizeQuestion(questionId);
        assertEq(help.balanceOf(asker), balanceBefore - 7 ether, "unused bounty must remain in pool");
        assertEq(help.balanceOf(address(forum)), 7 ether, "unused bounty missing from pool");
    }

    function testFifthBestAnswerAwardsMilestoneBonus() public {
        vm.prank(asker);
        help.approve(address(forum), 100 ether);
        uint256[5] memory questionIds;
        for (uint256 i; i < questionIds.length; ++i) questionIds[i] = post(asker, askerStudent, 3 ether);

        for (uint256 i; i < questionIds.length; ++i) {
            uint256 answerId = answer(firstAnswerer, firstStudent, questionIds[i]);
            vm.prank(asker);
            forum.selectBestAnswer(questionIds[i], answerId);
        }

        vm.warp(block.timestamp + 30 days);
        for (uint256 i; i < questionIds.length; ++i) forum.finalizeQuestion(questionIds[i]);

        assertEq(forum.bestAnswerCount(firstAnswerer), 5, "wrong best answer count");
        assertEq(help.balanceOf(firstAnswerer), 30 ether, "answer, bounty, and milestone rewards wrong");
    }
}
