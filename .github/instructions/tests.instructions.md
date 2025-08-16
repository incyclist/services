---
applyTo: '**/*.ts'
---
For test files, follow these guidelines:
1. Use descriptive names for test files, including the name of the module being tested. The pattern should be <module>.unit.test.ts for Unit tests and <module>.e2e.test.ts for E2E tests.
2. Store tests next to the code under test (in the same directory)
3. Write unit tests for externally exposed individual functions and public methods of exported classes.
4. Use mocking and stubbing to isolate tests from external dependencies.
5. Aim for high test coverage, but prioritize testing critical functionality.
6. Write tests that are easy to understand and maintain.
7. Use "describe" and "test" blocks to group related tests and improve test organization.
8. In the test: use a descriptive name for the test case that clearly conveys its purpose - not necessarily the expected outcome. don't start with "should ...", just describe the behavior being tested.
9. Most classes are singletons. These are tagged with @Singleton
10. if the class has methods that are tagged with @Injectable, then this can be used to automatically inject dependencies in tests, using the Inject function, e.g. if we have a singleton class User then other classes might have a method getUser that is tagged with @Injectable and can be injected into tests, using Inject('User')
11. If test data is required, store this in the __tests__ directory, following the logic of what the data represents ( user, routes, workouts )
12. create one "describe" block for each method being tested, and nest "test" blocks within it for each individual test case.
13. tests should be independent and not rely on each other. Use beforeEach/beforeAll and afterAll hooks to set up and tear down any shared state and/or mocks at the right level. If mocks are being used within a single test, then the afterEach hook of the describe block should be used to clean up.
14. It is important that tests are deterministic and produce the same results each time they are run. Avoid using random data or relying on external state.
15. It is important that all mocks are cleared also when all tests are finished, so that the next test class starts with a clean slate.
16. protected methods should only be tested indirectly ( by analyzing the call flow of the public methods and to generate a scenario/state where the protected method is called - in all relevant scenarios of the protected method )
17. keep a proper structure in your tests, imports at the top of the file ( external libraries, then internal libraries, then the module being tested ), then the methods in the same order as they appear in the file under test
