; Personnalisation de l'installateur (incluse automatiquement par electron-builder).
;
; Objectif : ne plus proposer de « réinstaller » quand le programme est déjà installé.
;   - Même version (ou plus récente) déjà installée -> on lance simplement le programme.
;   - Version plus ancienne installée -> on propose la mise à jour, faite en mode rapide
;     (silencieux, sans l'assistant), puis le programme est relancé.
;   - Rien d'installé -> assistant d'installation habituel.
; Les lancements silencieux (/S), avec --updated (mise à jour depuis l'application)
; ou l'instance élevée (UAC) ne sont pas concernés.

!include "FileFunc.nsh"
!include "WordFunc.nsh"

; preInit est exécuté au tout début de .onInit, avant le verrou « une seule instance »
; de l'installateur : on peut donc se relancer sans être bloqué par ce verrou.
!macro preInit
  ${GetParameters} $R0
  ; Mise à jour lancée depuis le logiciel (--updated) : même si l'ancienne version a
  ; demandé une installation muette (/S), on affiche la barre de progression.
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
  ${AndIf} ${Silent}
    SetSilent normal
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
  ${AndIfNot} ${Silent}
  ${AndIfNot} ${UAC_IsInnerInstance}
    ${If} ${RunningX64}
      SetRegView 64
    ${EndIf}
    ; Installation existante : d'abord pour l'utilisateur courant, sinon pour tous les utilisateurs.
    StrCpy $R2 ""
    StrCpy $R3 ""
    ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R2 != ""
      ReadRegStr $R3 HKCU "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${Else}
      ReadRegStr $R2 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
      ReadRegStr $R3 HKLM "${UNINSTALL_REGISTRY_KEY}" DisplayVersion
    ${EndIf}

    ${If} $R2 != ""
    ${AndIf} $R3 != ""
    ${AndIf} ${FileExists} "$R2\${APP_EXECUTABLE_FILENAME}"
      ; $R4 : 0 = identique, 1 = installée plus récente, 2 = installée plus ancienne
      ${VersionCompare} "$R3" "${VERSION}" $R4
      ${If} $R4 == 2
        MessageBox MB_YESNO|MB_ICONQUESTION \
          "${PRODUCT_NAME} $R3 est installé.$\r$\n$\r$\nMettre à jour vers la version ${VERSION} ?$\r$\n(Vos projets et réglages sont conservés.)" \
          IDYES maj_oui
        ; Non : on lance la version déjà installée
        Exec '"$R2\${APP_EXECUTABLE_FILENAME}"'
        Quit
        maj_oui:
        ; Mise à jour rapide : on se relance sans les questions de l'assistant (seule la
        ; barre de progression s'affiche) ; le programme redémarre à la fin.
        Exec '"$EXEPATH" --updated --force-run'
        Quit
      ${Else}
        ; Déjà à jour : on ouvre simplement le programme.
        Exec '"$R2\${APP_EXECUTABLE_FILENAME}"'
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; ——— Mise à jour avec barre de progression (--updated, sans /S) ———
; L'assistant saute déjà la licence et le choix du dossier quand --updated est présent.
; On saute aussi le choix « pour moi / pour tous » en reprenant celui de l'installation
; existante, puis la page de fin : le programme est relancé dès que l'installation est finie.
; Seule la page « Installation en cours » (barre de progression) reste donc visible.
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerUserInstallation == "1"
      StrCpy $isForceCurrentInstall "1"
    ${elseif} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${endif}
  ${endif}
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function finishPagePre
    ${if} ${isUpdated}
    ${andIfNot} ${Silent}
      Call StartApp
      Abort
    ${endif}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_PRE finishPagePre
  !insertmacro MUI_PAGE_FINISH
!macroend
