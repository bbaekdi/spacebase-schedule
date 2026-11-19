; SPACEBASE 주간 스케줄 설치 프로그램 (NSIS)
Unicode true
!include "MUI2.nsh"

!define APPNAME "SPACEBASE 주간 스케줄"
!define EXENAME "SPACEBASE-Schedule.exe"
!define VERSION "1.0.5"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SPACEBASE-Schedule"

Name "${APPNAME}"
OutFile "..\dist\SPACEBASE-Schedule-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\SPACEBASE-Schedule"
InstallDirRegKey HKCU "Software\SPACEBASE-Schedule" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "SPACEBASE"

!define MUI_ICON "..\build-icon.ico"
!define MUI_UNICON "..\build-icon.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "지금 실행하기"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=${LANG_KOREAN} "ProductName" "SPACEBASE Schedule"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileDescription" "SPACEBASE Schedule Setup"
VIAddVersionKey /LANG=${LANG_KOREAN} "CompanyName" "SPACEBASE"
VIAddVersionKey /LANG=${LANG_KOREAN} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_KOREAN} "ProductVersion" "${VERSION}"

Section "Install"
  ; 실행 중이면 종료 (업데이트 설치 대비)
  nsExec::Exec 'taskkill /IM "${EXENAME}" /F'
  Sleep 800
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  ; 회사 PC(서버)가 직원 PC에 나눠 줄 수 있게 설치 파일 사본을 보관
  CreateDirectory "$INSTDIR\update"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\update\setup.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\제거.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\SPACEBASE-Schedule" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "SPACEBASE"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\${EXENAME}"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
  ; 자동 업데이트(조용히 설치)일 때는 설치 후 프로그램을 다시 켠다
  IfSilent 0 +2
  Exec '"$INSTDIR\${EXENAME}"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${EXENAME}" /F'
  Sleep 800
  ; 스케줄 데이터(문서 폴더)는 지우지 않는다
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SPACEBASE-Schedule"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
  DeleteRegKey HKCU "Software\SPACEBASE-Schedule"
SectionEnd
