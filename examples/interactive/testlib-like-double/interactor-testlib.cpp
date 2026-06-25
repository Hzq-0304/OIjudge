#include "testlib.h"

#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 4) {
        quitf(FAIL_EXIT_CODE, "usage: interactor <input> <output> <answer>");
    }

    std::ifstream input(argv[1]);
    std::ofstream output(argv[2]);
    std::ifstream answer(argv[3]);

    int x;
    int expected;
    if (!(input >> x)) {
        quitf(FAIL_EXIT_CODE, "failed to read input");
    }

    if (!(answer >> expected)) {
        quitf(FAIL_EXIT_CODE, "failed to read answer");
    }

    output << "input x = " << x << "\n";
    output << "expected = " << expected << "\n";

    std::cout << x << std::endl;

    int actual;
    if (!(std::cin >> actual)) {
        output << "verdict = WA, missing output\n";
        quitf(WA_EXIT_CODE, "solution did not output an answer");
    }

    output << "actual = " << actual << "\n";

    if (actual != expected) {
        output << "verdict = WA\n";
        quitf(WA_EXIT_CODE, "wrong answer");
    }

    output << "verdict = AC\n";
    quitf(OK_EXIT_CODE, "accepted");
}
