#include<iostream>
using namespace std;    
 bool inperfect(int n) {
    int sum = 0;
    for (int i = 1; i <= n / 2; ++i) {
        if (n % i == 0)
            sum += i;
    }
    return sum == n;    
}
int main(){
    int number;
    cout << "Enter a non-negative integer: ";
    cin >> number;  
    if(inperfect(number)){
        cout << number << " is a perfect number." << endl;
    } else {
        cout << number << " is not a perfect number." << endl;
    }   
    cout << "Perfect divisors of " << number << " are: ";
    for (int i = 1; i <= number; i++) {
        if (number % i == 0 && inperfect(i)) {
            cout << i << " ";
        }
    }
    return 0;
}