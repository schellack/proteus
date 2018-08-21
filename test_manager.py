#!/usr/bin/env python3

"""
Runs the standard tests on-device
FUTURE: Manages power and sensors
"""
from test_agent import TestRunner


class TestManager():
    """ Runs tests on device """

    def __init__(self,
                 platform="photon",
                 user_app="user.bin",
                 bin_path=None,
                 scenario_path=None):
        if bin_path is None:
            bin_path = "bin/{}/".format(platform)
        self.bin_path = bin_path
        if scenario_path is None:
            scenario_path = "test/scenarios"
        self.scenario_path = scenario_path
        self.test_agent = TestRunner("/dev/ttyACM0", platform)
        # Runs test using the unit testing framework
        self.binfiles = []
        self.destructive_tests = False
        self.scenario_bin = user_app
        self.scenarios = []

    def add_test(self, test_bin):
        """ Adds a test binary to be run """
        self.binfiles.append(test_bin)

    def add_scenario(self, scenario_name):
        """ Adds a scenario (python script) to be run """
        self.binfiles.append(scenario_name)

    def add_destructive_test(self, test_bin):
        """ Adds test only if destructive tests have been enabled """
        if self.destructive_tests:
            self.binfiles.append(test_bin)

    def add_destructive_scenario(self, scenario_name):
        """ Adds scenario only if destructive tests have been enabled """
        if self.destructive_tests:
            self.binfiles.append(scenario_name)

    def enable_destructive_tests(self, enable):
        """ Enables destructive testing """
        self.destructive_tests = enable

    def run_tests(self, result_filename):
        """ Executes tests and writes results to file """
        for test in self.binfiles:
            print("================ {} ================".format(test))
            self.test_agent.run_test_suite(self.bin_path + test + ".bin")
        for scenario in self.scenarios:
            self.test_agent.run_test_scenario(
                "{}/{}".format(self.scenario_path,
                               scenario),
                self.bin_path + self.scenario_bin)

        xml = self.test_agent.get_xml()
        print(xml)
        with open(result_filename, "w") as file:
            file.write(xml)

    def get_xml(self):
        """ Returns XML """
        return self.test_agent.get_xml()
