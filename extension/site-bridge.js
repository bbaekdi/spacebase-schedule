// SPACEBASE 웹사이트에 "확장 프로그램이 설치되어 있다"고 알려 준다. (사이트는 이 표시가 있으면 일정 추가 창을 띄운다)
document.documentElement.dataset.sbeExt = chrome.runtime.getManifest().version;
