export async function GET() {
    try {
      const [interestResponse, usdResponse, cpiResponse] = await Promise.all([
        fetch("https://www.boi.org.il/PublicApi/GetInterest"),
        fetch("https://boi.org.il/PublicApi/GetExchangeRate?key=USD"),
        fetch(
          "https://api.cbs.gov.il/index/data/price?id=120010&format=json&download=false&last=2&lang=he"
        ),
      ]);
  
      const interestData = await interestResponse.json();
      const usdData = await usdResponse.json();
  
      const cpiData = await cpiResponse.json();

      const latestMonth = cpiData.month[0].date[0];
      const bankRate = Number(interestData.currentInterest);
      const primeRate = bankRate + 1.5;
  
      return Response.json({
        bankRate,
        primeRate,
        usdIls: Number(usdData.currentExchangeRate),
  
        cpiMonth: latestMonth.monthDesc,
        cpiYear: latestMonth.year,
        cpiValue: latestMonth.value,
        cpiChange: latestMonth.percent,
        cpiUpdatedAt: `15/${String(Number(latestMonth.month) + 1).padStart(2, "0")}/${latestMonth.year}`,
      });
    } catch (error) {
      return Response.json(
        {
          error: "Failed to load market data",
          details: String(error),
        },
        { status: 500 }
      );
    }
  }