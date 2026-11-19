// 처음 실행할 때 엑셀(11월 3주차) 내용으로 초기 데이터를 만든다.
module.exports = () => JSON.parse(JSON.stringify(require('./seed-data.json')));
