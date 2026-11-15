extern crate self as log;
#[macro_export] macro_rules! debug { ($($tokens:tt)*) => {{}}; }
use std::path::Path;
#[derive(Debug)] enum Error { PackageInstallFailed, AuthenticationFailed, Io(std::io::Error) }
impl From<std::io::Error> for Error { fn from(e:std::io::Error)->Self { Self::Io(e) } }
type Result<T> = std::result::Result<T,Error>;
struct Update;
impl Update {
    fn try_install_with_privileges(
        &self,
        pkg_path: &Path,
        install_cmd: &str,
        install_arg: &str,
    ) -> Result<()> {
        // 1. First try using pkexec (graphical sudo prompt)
        if let Ok(status) = std::process::Command::new("pkexec")
            .arg(install_cmd)
            .arg(install_arg)
            .arg(pkg_path)
            .status()
        {
            if status.success() {
                log::debug!("installed {pkg_path:?} with pkexec");
                return Ok(());
            }
        }

        // 2. Try zenity or kdialog for a graphical sudo experience
        if let Ok(password) = self.get_password_graphically() {
            if self.install_with_sudo(pkg_path, &password, install_cmd, install_arg)? {
                log::debug!("installed {pkg_path:?} with GUI sudo");
                return Ok(());
            }
        }

        // 3. Final fallback: terminal sudo
        let status = std::process::Command::new("sudo")
            .arg(install_cmd)
            .arg(install_arg)
            .arg(pkg_path)
            .status()?;

        if status.success() {
            log::debug!("installed {pkg_path:?} with sudo");
            Ok(())
        } else {
            Err(Error::PackageInstallFailed)
        }
    }

    fn get_password_graphically(&self) -> Result<String> {
        // Try zenity first
        let zenity_result = std::process::Command::new("zenity")
            .args([
                "--password",
                "--title=Authentication Required",
                "--text=Enter your password to install the update:",
            ])
            .output();

        if let Ok(output) = zenity_result {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }

        // Fall back to kdialog if zenity fails or isn't available
        let kdialog_result = std::process::Command::new("kdialog")
            .args(["--password", "Enter your password to install the update:"])
            .output();

        if let Ok(output) = kdialog_result {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }

        Err(Error::AuthenticationFailed)
    }

    fn install_with_sudo(
        &self,
        pkg_path: &Path,
        password: &str,
        install_cmd: &str,
        install_arg: &str,
    ) -> Result<bool> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new("sudo")
            .arg("-S") // read password from stdin
            .arg(install_cmd)
            .arg(install_arg)
            .arg(pkg_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            // Write password to stdin
            writeln!(stdin, "{password}")?;
        }

        let status = child.wait()?;
        Ok(status.success())
    }
}
fn main() {
    let package = std::env::args().nth(1).expect("own inert package path");
    println!("{:?}", Update.try_install_with_privileges(Path::new(&package), "dpkg", "-i"));
}
