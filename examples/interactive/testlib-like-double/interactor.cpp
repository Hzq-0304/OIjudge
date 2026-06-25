#include <fstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 4) {
        std::cerr << "usage: interactor <input> <output> <answer>\n";
        return 3;
    }

    std::ifstream input(argv[1]);
    std::ofstream output(argv[2]);
    std::ifstream answer(argv[3]);

    int x;
    int expected;
    if (!(input >> x)) {
        std::cerr << "failed to read input\n";
        return 3;
    }

    if (!(answer >> expected)) {
        std::cerr << "failed to read answer\n";
        return 3;
    }

    output << "input x = " << x << "\n";
    output << "expected = " << expected << "\n";

    std::cout << x << std::endl;

    int actual;
    if (!(std::cin >> actual)) {
        std::cerr << "solution did not output an answer\n";
        output << "verdict = WA, missing output\n";
        return 1;
    }

    output << "actual = " << actual << "\n";

    if (actual != expected) {
        std::cerr << "wrong answer: expected " << expected << ", got " << actual << "\n";
        output << "verdict = WA\n";
        return 1;
    }

    output << "verdict = AC\n";
    return 0;
}
