// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IVideoHelpToken { function reward(address learner, uint256 amount) external; function rewardAnswer(address learner, uint256 amount) external; }

contract ProoflyForumVideoDemo {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("ProoflyForum"); bytes32 private constant VERSION_HASH = keccak256("1");
    bytes32 public constant ACCOUNT_ACTION_TYPEHASH = keccak256("AccountAction(address wallet,bytes32 studentId,uint8 action,uint256 questionId,uint96 bounty,uint256 nonce,uint256 deadline)");
    IVideoHelpToken public immutable help; address public immutable accountIssuer; address public immutable asker; bytes32 public immutable askerStudentId; uint256 public immutable questionLifetime; uint256 public nextQuestionId = 2;
    struct Question { address asker; bytes32 askerStudentId; uint96 bounty; bool sponsored; bool finalized; uint64 expiresAt; uint256 answerCount; uint256 selectedAnswerId; address selectedAnswerer; }
    mapping(uint256 => Question) public questions; mapping(uint256 => mapping(uint256 => address)) public answererOf; mapping(uint256 => mapping(bytes32 => uint256)) public answerIdByStudent; mapping(uint256 => bool) public usedAccountNonces;
    event AnswerSubmitted(uint256 indexed questionId, uint256 indexed answerId, address indexed answerer); event AnswerEdited(uint256 indexed questionId, uint256 indexed answerId, address indexed editor); event BestAnswerChanged(uint256 indexed questionId, uint256 indexed answerId, address indexed answerer); event QuestionFinalized(uint256 indexed questionId, bool solved, address indexed answerer, uint256 reward);

    constructor(IVideoHelpToken helpToken, address issuer, address demoAsker, bytes32 demoAskerStudentId, uint256 lifetime) {
        require(address(helpToken) != address(0) && issuer != address(0) && demoAsker != address(0) && lifetime >= 1 minutes && lifetime <= 1 hours, "Invalid configuration");
        help = helpToken; accountIssuer = issuer; asker = demoAsker; askerStudentId = demoAskerStudentId; questionLifetime = lifetime;
        questions[1] = Question(demoAsker, demoAskerStudentId, 5 ether, true, false, 0, 0, 0, address(0));
    }
    function submitAnswer(uint256 questionId, bytes32 studentId, uint256 nonce, uint256 deadline, bytes calldata signature) external returns (uint256 answerId) {
        Question storage question = questions[questionId]; require(question.asker != address(0) && (question.expiresAt == 0 || block.timestamp < question.expiresAt), "Question is not open"); require(msg.sender != question.asker && studentId != question.askerStudentId, "Cannot answer own question");
        _useClaim(studentId, 2, questionId, nonce, deadline, signature); require(answerIdByStudent[questionId][studentId] == 0, "Student already answered");
        if (question.expiresAt == 0) question.expiresAt = uint64(block.timestamp + questionLifetime); answerId = ++question.answerCount; answerIdByStudent[questionId][studentId] = answerId; answererOf[questionId][answerId] = msg.sender; help.rewardAnswer(msg.sender, 1 ether); emit AnswerSubmitted(questionId, answerId, msg.sender);
    }
    function editAnswer(uint256 questionId, bytes32 studentId, uint256 nonce, uint256 deadline, bytes calldata signature) external {
        require(block.timestamp < questions[questionId].expiresAt, "Question is not open"); _useClaim(studentId, 3, questionId, nonce, deadline, signature); uint256 answerId = answerIdByStudent[questionId][studentId]; require(answerId != 0 && answererOf[questionId][answerId] == msg.sender, "No answer to edit"); emit AnswerEdited(questionId, answerId, msg.sender);
    }
    function selectBestAnswer(uint256 questionId, uint256 answerId) external {
        Question storage question = questions[questionId]; require(msg.sender == question.asker && block.timestamp < question.expiresAt, "Selection unavailable"); address answerer = answererOf[questionId][answerId]; require(answerer != address(0), "Invalid answer"); question.selectedAnswerId = answerId; question.selectedAnswerer = answerer; emit BestAnswerChanged(questionId, answerId, answerer);
    }
    function finalizeQuestion(uint256 questionId) external {
        Question storage question = questions[questionId]; require(block.timestamp >= question.expiresAt && !question.finalized && question.selectedAnswerer != address(0), "Not finalizable"); question.finalized = true; help.reward(question.selectedAnswerer, question.bounty); emit QuestionFinalized(questionId, true, question.selectedAnswerer, question.bounty);
    }
    function _useClaim(bytes32 studentId, uint8 action, uint256 questionId, uint256 nonce, uint256 deadline, bytes calldata signature) internal {
        require(block.timestamp <= deadline && !usedAccountNonces[nonce] && signature.length == 65, "Invalid claim"); bytes32 structHash = keccak256(abi.encode(ACCOUNT_ACTION_TYPEHASH, msg.sender, studentId, action, questionId, uint96(0), nonce, deadline)); bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))); bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        bytes32 r; bytes32 s; uint8 v; assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) } require(ecrecover(digest, v, r, s) == accountIssuer, "Invalid authorization"); usedAccountNonces[nonce] = true;
    }
}
