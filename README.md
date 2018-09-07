# Proteus
A continuous integration on-device test coordination system that manages deploying to Particle hardware platforms.
Able to execute unit and integration tests built with spark-unit-test on multiple Particle platforms concurrently.
Collects and uploads test results to CI system.

Compatable with Appveyor. Tested with Raspberry Pi (3 Model B) as test-host.
Tests run on Photon and Electron.
MIT License.

## Prereqs
Setup CI (as of 9/7/2018 only Appveyor is supported). It is recommended to use an ubuntu image and makefile-based build process.
Ensure all test binaries are built and packaged as artifacts in a zip file.
It is recommened that binaries follow a `bin/<platform>/<bin_name>.bin` structure. If your CI has an API key record it and save it for use later in this process.
Your on-device tests should be authored with spark-unit-test, and should report the results of each test (incluing assertions) to the serial port (USB Serial) of the test platform.
See the `appveyor.yml.example` for guidence on how to integrate proteus with appveyor.yml in your repo.

## Installation
- Select a host platform (debian linux based)
- Edit `init/proteus-test-daemon.service` with the user and group to run the daemon, making any other changes specific to your system. If you are not using systemd you will need to port the configuration to your init system.
- Run `init/host_setup.sh` to install prereqs, daemon, and copy data to `/usr/local/bin/proteus-test-daemon/`, check that no errors occur.
- Edit `.config` in `/usr/local/bin/proteus-test-daemon/` with your CI API key and any other custom settings.
- Modify `run_test.py` in the proteus-test-daemon folder or modify `proteus.sh` to run your master test file. (See run_test.py.example for a starting point)
- Author any test-scenarios that are required (Power Cycle or other external-excitation test). TestScenario may be used as a base class for proprietary extesnions (see `test_scenario.py`). 

### Test Scenarios
The TestScenario call can be extended to support REST calls for cloud based-configuration, including setting particle variables/function calls. It can take advantage of the GPIOs on the Raspberry Pi (using a mock pin factory on other systems) to provide electrical signals to the device (for example, driving the RST pin high). It is recommended to define a custom class inheriting from TestScenario to interface with your custom infrastructure.

## Running Proteus
The host setup script will install and enable the daemon. Be sure to connect your hardware platform under test via USB to your test platform. Proteus will check CI for new builds at a set interval and automatically download tests, execute them, and report the test results to CI (they will also be saved as an XML file, but will be overwritten when new builds are available).

## Troubleshooting
Proteus generates a `log.txt` file in the proteus-test-daemon directory. The output of this file can point to misconfigurations or failures in a test. Crash reports and exceptions encountered while running tests will appear in this file.

## Contributing
Adding new functionality to Proteus is easy. Simply fork the repo, make your changes, and create a pull request against the master directory. Include any and all testing done in the PR.
