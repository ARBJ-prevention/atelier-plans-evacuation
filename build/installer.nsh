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
        ; Mise à jour rapide : on se relance en silencieux ; le programme redémarre à la fin.
        Exec '"$EXEPATH" /S --updated --force-run'
        Quit
      ${Else}
        ; Déjà à jour : on ouvre simplement le programme.
        Exec '"$R2\${APP_EXECUTABLE_FILENAME}"'
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
