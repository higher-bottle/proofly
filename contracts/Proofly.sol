// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract HelpToken is ERC20, Ownable {
    uint256 public constant HELP_PER_ETH = 100;
    uint256 public constant ANSWER_REWARD_LIFETIME = 90 days;

    struct ExpiringGrant {
        uint128 amount;
        uint64 expiresAt;
    }

    mapping(address => ExpiringGrant[]) private _expiringGrants;
    mapping(address => uint256) private _grantCursor;
    bool private _escrowTransfer;

    event HelpPurchased(address indexed buyer, uint256 ethPaid, uint256 helpReceived);
    event ExpiringRewardIssued(address indexed learner, uint256 amount, uint256 expiresAt);
    event ExpiredHelpBurned(address indexed learner, uint256 amount);

    constructor() ERC20("Proofly HELP", "HELP") Ownable(msg.sender) { _mint(msg.sender, 1_000_000 ether); }
    function reward(address learner, uint256 amount) external onlyOwner { _mint(learner, amount); }

    function rewardAnswer(address learner, uint256 amount) external onlyOwner {
        uint64 expiresAt = uint64(block.timestamp + ANSWER_REWARD_LIFETIME);
        _mint(learner, amount);
        _expiringGrants[learner].push(ExpiringGrant(uint128(amount), expiresAt));
        emit ExpiringRewardIssued(learner, amount, expiresAt);
    }

    function buyHelp() external payable returns (uint256 amount) {
        require(msg.value > 0, "Send ETH to buy HELP");
        amount = msg.value * HELP_PER_ETH;
        _mint(msg.sender, amount);
        emit HelpPurchased(msg.sender, msg.value, amount);
    }

    function expiringBalanceOf(address learner) external view returns (uint256 active, uint256 nextExpiry) {
        ExpiringGrant[] storage grants = _expiringGrants[learner];
        for (uint256 i; i < grants.length; ++i) {
            if (grants[i].expiresAt > block.timestamp && grants[i].amount > 0) {
                active += grants[i].amount;
                if (nextExpiry == 0 || grants[i].expiresAt < nextExpiry) nextExpiry = grants[i].expiresAt;
            }
        }
    }

    function purgeExpired(address learner) external returns (uint256) { return _purgeExpired(learner); }

    function escrowFrom(address learner, uint256 amount) external onlyOwner {
        _spendAllowance(learner, msg.sender, amount);
        _escrowTransfer = true;
        _transfer(learner, msg.sender, amount);
        _escrowTransfer = false;
    }

    function withdrawProceeds(address payable recipient) external onlyOwner {
        require(recipient != address(0), "Recipient required");
        (bool sent,) = recipient.call{value: address(this).balance}("");
        require(sent, "ETH withdrawal failed");
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            _purgeExpired(from);
            uint256 remaining = value;
            ExpiringGrant[] storage grants = _expiringGrants[from];
            for (uint256 i; i < grants.length && remaining > 0; ++i) {
                if (grants[i].expiresAt <= block.timestamp) continue;
                uint256 used = remaining < grants[i].amount ? remaining : grants[i].amount;
                if (used == 0) continue;
                grants[i].amount -= uint128(used);
                remaining -= used;
                if (to != address(0) && !_escrowTransfer) _expiringGrants[to].push(ExpiringGrant(uint128(used), grants[i].expiresAt));
            }
        }
        super._update(from, to, value);
    }

    function _purgeExpired(address learner) internal returns (uint256 expired) {
        ExpiringGrant[] storage grants = _expiringGrants[learner];
        for (uint256 i; i < grants.length; ++i) {
            if (grants[i].expiresAt <= block.timestamp && grants[i].amount > 0) {
                expired += grants[i].amount;
                grants[i].amount = 0;
            }
        }
        if (expired > 0) {
            super._update(learner, address(0), expired);
            emit ExpiredHelpBurned(learner, expired);
        }
    }
}

contract ProoflyBadge is ERC721URIStorage, EIP712, Ownable {
    bytes32 public constant MINT_CLAIM_TYPEHASH = keccak256("MintClaim(address learner,bytes32 badgeKey,bytes32 metadataHash,uint256 nonce,uint256 deadline)");
    uint256 public nextTokenId = 1;
    address public issuer;
    mapping(address => bool) public badgeMinted;
    mapping(address => mapping(bytes32 => bool)) public badgeTypeMinted;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    event BadgeMinted(address indexed learner, uint256 indexed tokenId, string metadataURI);
    event AchievementBadgeMinted(address indexed learner, uint256 indexed tokenId, bytes32 indexed badgeKey, string badgeId, string metadataURI);
    event IssuerChanged(address indexed previousIssuer, address indexed newIssuer);

    constructor(address initialIssuer) ERC721("Proofly Learning Badge", "PLB") EIP712("ProoflyBadge", "1") Ownable(msg.sender) {
        require(initialIssuer != address(0), "Issuer required");
        issuer = initialIssuer;
    }

    function setIssuer(address newIssuer) external onlyOwner {
        require(newIssuer != address(0), "Issuer required");
        emit IssuerChanged(issuer, newIssuer);
        issuer = newIssuer;
    }

    function claimDigest(address learner, string calldata badgeId, string calldata metadataURI, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        return _claimDigest(learner, keccak256(bytes(badgeId)), keccak256(bytes(metadataURI)), nonce, deadline);
    }

    function mintLearningBadge(string calldata metadataURI, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 tokenId) {
        tokenId = _mintBadge("learning-pioneer", metadataURI, nonce, deadline, signature);
    }

    function mintBadge(string calldata badgeId, string calldata metadataURI, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 tokenId) {
        tokenId = _mintBadge(badgeId, metadataURI, nonce, deadline, signature);
    }

    function _mintBadge(string memory badgeId, string memory metadataURI, uint256 nonce, uint256 deadline, bytes memory signature) internal returns (uint256 tokenId) {
        bytes32 badgeKey = keccak256(bytes(badgeId));
        require(bytes(badgeId).length != 0, "Badge ID required");
        require(block.timestamp <= deadline, "Claim expired");
        require(!usedNonces[msg.sender][nonce], "Claim already used");
        require(!badgeTypeMinted[msg.sender][badgeKey], "Badge already minted for this address");
        bytes32 digest = _claimDigest(msg.sender, badgeKey, keccak256(bytes(metadataURI)), nonce, deadline);
        require(ECDSA.recover(digest, signature) == issuer, "Invalid badge authorization");
        usedNonces[msg.sender][nonce] = true;
        badgeTypeMinted[msg.sender][badgeKey] = true;
        if (badgeKey == keccak256(bytes("learning-pioneer"))) badgeMinted[msg.sender] = true;
        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, metadataURI);
        emit BadgeMinted(msg.sender, tokenId, metadataURI);
        emit AchievementBadgeMinted(msg.sender, tokenId, badgeKey, badgeId, metadataURI);
    }

    function _claimDigest(address learner, bytes32 badgeKey, bytes32 metadataHash, uint256 nonce, uint256 deadline) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(MINT_CLAIM_TYPEHASH, learner, badgeKey, metadataHash, nonce, deadline)));
    }
}

contract ProoflyForum is Ownable, EIP712 {
    bytes32 public constant ACCOUNT_ACTION_TYPEHASH = keccak256("AccountAction(address wallet,bytes32 studentId,uint8 action,uint256 questionId,uint96 bounty,uint256 nonce,uint256 deadline)");
    uint8 public constant ACTION_POST = 1;
    uint8 public constant ACTION_ANSWER = 2;
    uint8 public constant ACTION_EDIT = 3;
    uint256 public nextQuestionId = 1;
    uint256 public immutable questionLifetime;
    uint256 public constant ANSWER_REWARD = 1 ether;
    uint256 public constant MILESTONE_REWARD = 10 ether;
    HelpToken public immutable help;
    address public accountIssuer;

    struct Question {
        address asker;
        bytes32 askerStudentId;
        uint96 bounty;
        bool sponsored;
        bool finalized;
        uint64 expiresAt;
        uint256 answerCount;
        uint256 selectedAnswerId;
        address selectedAnswerer;
    }
    mapping(uint256 => Question) public questions;
    mapping(uint256 => mapping(uint256 => address)) public answererOf;
    mapping(uint256 => mapping(uint256 => bytes32)) public answerStudentOf;
    mapping(uint256 => mapping(bytes32 => uint256)) public answerIdByStudent;
    mapping(bytes32 => uint256) public sponsoredQuestionsUsed;
    mapping(address => uint256) public bestAnswerCount;
    mapping(uint256 => bool) public usedAccountNonces;

    event QuestionPosted(uint256 indexed questionId, address indexed asker, uint256 bounty, bool sponsored, uint256 expiresAt);
    event AnswerSubmitted(uint256 indexed questionId, uint256 indexed answerId, address indexed answerer);
    event AnswerEdited(uint256 indexed questionId, uint256 indexed answerId, address indexed editor);
    event BestAnswerChanged(uint256 indexed questionId, uint256 indexed answerId, address indexed answerer);
    event QuestionFinalized(uint256 indexed questionId, bool solved, address indexed answerer, uint256 reward);

    event AccountIssuerChanged(address indexed previousIssuer, address indexed newIssuer);
    event UnusedBountyReturnedToPool(uint256 indexed questionId, uint256 amount);

    constructor(HelpToken helpToken, address initialAccountIssuer, uint256 initialQuestionLifetime) Ownable(msg.sender) EIP712("ProoflyForum", "1") {
        require(initialAccountIssuer != address(0), "Account issuer required");
        require(initialQuestionLifetime >= 1 minutes && initialQuestionLifetime <= 30 days, "Invalid question lifetime");
        help = helpToken;
        accountIssuer = initialAccountIssuer;
        questionLifetime = initialQuestionLifetime;
    }

    function setAccountIssuer(address newIssuer) external onlyOwner {
        require(newIssuer != address(0), "Account issuer required");
        emit AccountIssuerChanged(accountIssuer, newIssuer);
        accountIssuer = newIssuer;
    }

    function postQuestion(uint96 bounty, bytes32 studentId, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 questionId) {
        require(bounty == 3 ether || bounty == 5 ether || bounty == 7 ether, "Choose 3, 5, or 7 HELP");
        _useAccountClaim(studentId, ACTION_POST, 0, bounty, nonce, deadline, signature);
        bool sponsored = sponsoredQuestionsUsed[studentId] < 3;
        if (sponsored) sponsoredQuestionsUsed[studentId]++;
        else help.escrowFrom(msg.sender, bounty);
        questionId = nextQuestionId++;
        uint64 expiresAt = uint64(block.timestamp + questionLifetime);
        questions[questionId] = Question(msg.sender, studentId, bounty, sponsored, false, expiresAt, 0, 0, address(0));
        emit QuestionPosted(questionId, msg.sender, bounty, sponsored, expiresAt);
    }

    function submitAnswer(uint256 questionId, bytes32 studentId, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 answerId) {
        Question storage question = questions[questionId];
        require(question.asker != address(0) && block.timestamp < question.expiresAt, "Question is not open");
        require(question.asker != msg.sender, "Cannot answer your own question");
        _useAccountClaim(studentId, ACTION_ANSWER, questionId, 0, nonce, deadline, signature);
        require(question.askerStudentId != studentId, "Cannot answer your own question");
        require(answerIdByStudent[questionId][studentId] == 0, "Student account already answered");
        answerId = ++question.answerCount;
        answererOf[questionId][answerId] = msg.sender;
        answerStudentOf[questionId][answerId] = studentId;
        answerIdByStudent[questionId][studentId] = answerId;
        help.rewardAnswer(msg.sender, ANSWER_REWARD);
        emit AnswerSubmitted(questionId, answerId, msg.sender);
    }

    function editAnswer(uint256 questionId, bytes32 studentId, uint256 nonce, uint256 deadline, bytes calldata signature) external {
        Question storage question = questions[questionId];
        require(question.asker != address(0) && block.timestamp < question.expiresAt, "Question is not open");
        _useAccountClaim(studentId, ACTION_EDIT, questionId, 0, nonce, deadline, signature);
        uint256 answerId = answerIdByStudent[questionId][studentId];
        require(answerId != 0, "No answer to edit");
        emit AnswerEdited(questionId, answerId, msg.sender);
    }

    function selectBestAnswer(uint256 questionId, uint256 answerId) external {
        Question storage question = questions[questionId];
        require(msg.sender == question.asker, "Only the asker can choose");
        require(block.timestamp < question.expiresAt, "Selection period ended");
        address answerer = answererOf[questionId][answerId];
        require(answerer != address(0), "Invalid answer");
        question.selectedAnswerId = answerId;
        question.selectedAnswerer = answerer;
        emit BestAnswerChanged(questionId, answerId, answerer);
    }

    function finalizeQuestion(uint256 questionId) external {
        Question storage question = questions[questionId];
        require(question.asker != address(0), "Question does not exist");
        require(block.timestamp >= question.expiresAt, "Question has not expired");
        require(!question.finalized, "Question already finalized");
        question.finalized = true;

        address winner = question.selectedAnswerer;
        if (winner != address(0)) {
            if (question.sponsored) help.reward(winner, question.bounty);
            else require(help.transfer(winner, question.bounty), "Bounty payout failed");
            uint256 wins = ++bestAnswerCount[winner];
            if (wins % 5 == 0) help.reward(winner, MILESTONE_REWARD);
            emit QuestionFinalized(questionId, true, winner, question.bounty);
        } else {
            if (!question.sponsored) emit UnusedBountyReturnedToPool(questionId, question.bounty);
            emit QuestionFinalized(questionId, false, address(0), 0);
        }
    }

    function accountActionDigest(address wallet, bytes32 studentId, uint8 action, uint256 questionId, uint96 bounty, uint256 nonce, uint256 deadline) external view returns (bytes32) {
        return _accountActionDigest(wallet, studentId, action, questionId, bounty, nonce, deadline);
    }

    function _useAccountClaim(bytes32 studentId, uint8 action, uint256 questionId, uint96 bounty, uint256 nonce, uint256 deadline, bytes calldata signature) internal {
        require(studentId != bytes32(0), "Student account required");
        require(block.timestamp <= deadline, "Account claim expired");
        require(!usedAccountNonces[nonce], "Account claim already used");
        require(ECDSA.recover(_accountActionDigest(msg.sender, studentId, action, questionId, bounty, nonce, deadline), signature) == accountIssuer, "Invalid account authorization");
        usedAccountNonces[nonce] = true;
    }

    function _accountActionDigest(address wallet, bytes32 studentId, uint8 action, uint256 questionId, uint96 bounty, uint256 nonce, uint256 deadline) internal view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ACCOUNT_ACTION_TYPEHASH, wallet, studentId, action, questionId, bounty, nonce, deadline)));
    }

    function withdrawHelpPurchaseProceeds(address payable recipient) external onlyOwner {
        help.withdrawProceeds(recipient);
    }
}
