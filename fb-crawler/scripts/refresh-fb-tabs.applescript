-- Refresht alle FB-Group-Tabs in Chrome.
-- Trigger via launchd alle 15 Min (Whitepaper §2.1: kein Auto-Scroll, aber
-- Auto-Reload zeigt jeweils die neuesten Top-of-Feed-Posts).
--
-- Sequenziell mit 8s Delay pro Tab — vermeidet, dass FB alle Reloads
-- gleichzeitig sieht (Rate-Limit-/Bot-Trigger-Risiko).

tell application "Google Chrome"
  if not running then return
  set tabsToReload to {}
  repeat with w in (every window)
    repeat with t in (every tab of w)
      try
        set u to URL of t
        if u starts with "https://www.facebook.com/groups/" then
          set end of tabsToReload to t
        end if
      end try
    end repeat
  end repeat
  repeat with t in tabsToReload
    try
      reload t
    end try
    delay 8
  end repeat
end tell
